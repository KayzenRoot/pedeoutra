-- PedeOutra V2 — importação de produtos com job idempotente (PDA-VALUE-003 / #46)
-- S1192 suprimido abaixo: status/action/errcode sao contrato explicito do job;
-- a migration e imutavel e validada por testes de DB/restore.
-- Não armazena arquivo bruto; guarda apenas linhas normalizadas e o resumo.

create table public.product_import_jobs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'completed', -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
  total_rows integer not null,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  ignored_count integer not null default 0,
  error_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_import_jobs_status_check check (status in ('completed', 'failed')),
  constraint product_import_jobs_total_check check (total_rows between 1 and 500),
  constraint product_import_jobs_counts_check check (
    created_count >= 0 and updated_count >= 0 and ignored_count >= 0 and error_count >= 0
  )
);

create index product_import_jobs_org_created_idx
  on public.product_import_jobs (organization_id, created_at desc);

create table public.product_import_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.product_import_jobs(id) on delete cascade,
  organization_id uuid not null,
  line integer not null,
  action text not null,
  sku text,
  name text,
  error text,
  product_id uuid,
  created_at timestamptz not null default now(),
  constraint product_import_rows_action_check check (action in ('create', 'update', 'ignore', 'error')), -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
  constraint product_import_rows_line_check check (line between 1 and 10000),
  constraint product_import_rows_product_fk
    foreign key (product_id, organization_id)
    references public.products(id, organization_id)
    on delete set null (product_id)
);

create index product_import_rows_job_idx
  on public.product_import_rows (job_id, line);

create trigger product_import_jobs_set_updated_at
  before update on public.product_import_jobs
  for each row execute function app.set_updated_at();

alter table public.product_import_jobs enable row level security;
alter table public.product_import_rows enable row level security;

revoke all on public.product_import_jobs from anon, authenticated;
revoke all on public.product_import_rows from anon, authenticated;
grant all on public.product_import_jobs to service_role;
grant all on public.product_import_rows to service_role;

create or replace function public.api_import_products(
  p_job_id uuid,
  p_organization_id uuid,
  p_actor_id uuid,
  p_rows jsonb
)
returns table (
  job_id uuid,
  status text,
  total_rows integer,
  created_count integer,
  updated_count integer,
  ignored_count integer,
  error_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.product_import_jobs;
  v_row jsonb;
  v_line integer;
  v_action text;
  v_name text;
  v_sku text;
  v_category text;
  v_unit text;
  v_price integer;
  v_active boolean;
  v_min integer;
  v_inc integer;
  v_category_id uuid;
  v_product_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_ignored integer := 0;
  v_count integer := 0;
  v_skus text[] := '{}';
begin
  if p_job_id is null then
    raise exception 'invalid_import_job' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
  end if;
  if p_organization_id is null
     or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'invalid_organization' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
  end if;
  if p_actor_id is null
     or not exists (select 1 from auth.users u where u.id = p_actor_id) then
    raise exception 'invalid_actor' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_import_rows' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'import_row_limit' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
  end if;

  select * into v_existing
    from public.product_import_jobs j
   where j.id = p_job_id
   for update;

  if found then
    if v_existing.organization_id <> p_organization_id then
      raise exception 'job_tenant_mismatch' using errcode = '42501';
    end if;
    if v_existing.status = 'completed' then -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
      return query select
        v_existing.id,
        v_existing.status,
        v_existing.total_rows,
        v_existing.created_count,
        v_existing.updated_count,
        v_existing.ignored_count,
        v_existing.error_count;
      return;
    end if;
    delete from public.product_import_rows r where r.job_id = p_job_id;
    update public.product_import_jobs
       set status = 'completed', -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
           total_rows = jsonb_array_length(p_rows),
           created_count = 0,
           updated_count = 0,
           ignored_count = 0,
           error_count = 0
     where id = p_job_id;
  else
    insert into public.product_import_jobs
      (id, organization_id, actor_user_id, status, total_rows)
    values
      (p_job_id, p_organization_id, p_actor_id, 'completed', jsonb_array_length(p_rows));
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_count := v_count + 1;
    v_line := coalesce((v_row->>'line')::integer, v_count);
    v_action := coalesce(nullif(v_row->>'action', ''), 'auto');
    v_name := btrim(coalesce(v_row->>'name', ''));
    v_sku := nullif(upper(btrim(coalesce(v_row->>'sku', ''))), '');
    v_category := nullif(btrim(coalesce(v_row->>'category', '')), '');
    v_unit := btrim(coalesce(v_row->>'unit', ''));
    v_price := nullif(v_row->>'price_cents', '')::integer;
    v_active := coalesce((v_row->>'active')::boolean, true);
    v_min := coalesce((v_row->>'min_quantity')::integer, 1);
    v_inc := coalesce((v_row->>'quantity_increment')::integer, 1);

    if v_action not in ('auto', 'create', 'update', 'ignore') then
      raise exception 'invalid_import_action' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if char_length(v_name) < 1 or char_length(v_name) > 120
       or v_name ~ '[<>]' then
      raise exception 'invalid_import_name' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if v_sku is not null and v_sku !~ '^[A-Z0-9][A-Z0-9._-]{1,31}$' then
      raise exception 'invalid_import_sku' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if v_category is not null
       and (char_length(v_category) > 80 or v_category ~ '[<>]') then
      raise exception 'invalid_import_category' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if char_length(v_unit) < 1 or char_length(v_unit) > 20 or v_unit ~ '[<>]' then
      raise exception 'invalid_import_unit' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if v_price is not null and (v_price < 0 or v_price > 1000000) then
      raise exception 'invalid_import_price' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if v_min < 1 or v_min > 999 or v_inc < 1 or v_inc > 999 or v_min % v_inc <> 0 then
      raise exception 'invalid_import_quantity_rule' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;

    if v_action = 'ignore' then
      v_ignored := v_ignored + 1;
      insert into public.product_import_rows
        (job_id, organization_id, line, action, sku, name)
      values
        (p_job_id, p_organization_id, v_line, 'ignore', v_sku, v_name);
      continue;
    end if;

    if v_sku is not null and v_sku = any(v_skus) then
      raise exception 'duplicate_import_sku' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if v_sku is not null then
      v_skus := array_append(v_skus, v_sku);
    end if;

    if v_category is not null then
      select c.id into v_category_id
        from public.product_categories c
       where c.organization_id = p_organization_id
         and lower(c.name) = lower(v_category)
       limit 1;
      if not found then
        insert into public.product_categories (organization_id, name)
        values (p_organization_id, v_category)
        returning id into v_category_id;
      end if;
    else
      v_category_id := null;
    end if;

    v_product_id := null;
    if v_sku is not null then
      select p.id into v_product_id
        from public.products p
       where p.organization_id = p_organization_id
         and p.sku = v_sku
       limit 1;
    end if;

    if v_action = 'create' and v_product_id is not null then
      raise exception 'import_sku_exists' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if v_action = 'update' and v_product_id is null then
      raise exception 'import_sku_not_found' using errcode = '22023'; -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    end if;
    if v_action = 'auto' then
      v_action := case when v_product_id is null then 'create' else 'update' end;
    end if;

    if v_action = 'create' then
      insert into public.products (
        organization_id, name, sku, unit, price_cents, active,
        min_quantity, quantity_increment, category_id
      ) values (
        p_organization_id, v_name, v_sku, v_unit, v_price, v_active,
        v_min, v_inc, v_category_id
      )
      returning id into v_product_id;
      v_created := v_created + 1;
    else
      update public.products
         set name = v_name,
             sku = v_sku,
             unit = v_unit,
             price_cents = v_price,
             active = v_active,
             min_quantity = v_min,
             quantity_increment = v_inc,
             category_id = v_category_id
       where id = v_product_id
         and organization_id = p_organization_id;
      v_updated := v_updated + 1;
    end if;

    insert into public.product_import_rows
      (job_id, organization_id, line, action, sku, name, product_id)
    values
      (p_job_id, p_organization_id, v_line, v_action, v_sku, v_name, v_product_id);
  end loop;

  update public.product_import_jobs
     set created_count = v_created,
         updated_count = v_updated,
         ignored_count = v_ignored,
         error_count = 0
   where id = p_job_id;

  return query select
    p_job_id,
    'completed'::text, -- NOSONAR: literal de contrato do job/errcode; migration testada por DB/restore.
    jsonb_array_length(p_rows),
    v_created,
    v_updated,
    v_ignored,
    0;
end;
$$;

revoke all on function public.api_import_products(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_import_products(uuid, uuid, uuid, jsonb) to service_role;
