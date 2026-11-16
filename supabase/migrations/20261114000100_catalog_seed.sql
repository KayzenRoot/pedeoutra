-- PedeOutra V2 — seed idempotente de catálogo por template (PDA-VALUE-014 / #57)
-- S1192 suprimido abaixo: status/errcode sao contrato explicito do seed;
-- a migration e imutavel e validada por testes de DB/restore.
-- Não cria preço, estoque, imagem ou disponibilidade; somente produtos escolhidos.

create table public.catalog_seed_jobs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  template_code text not null,
  template_version integer not null,
  status text not null default 'completed', -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  total_items integer not null,
  created_count integer not null default 0,
  skipped_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_seed_jobs_status_check check (status in ('completed', 'failed')), -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  constraint catalog_seed_jobs_total_check check (total_items between 0 and 50),
  constraint catalog_seed_jobs_code_check check (template_code ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint catalog_seed_jobs_version_check check (template_version >= 1)
);

create index catalog_seed_jobs_org_created_idx
  on public.catalog_seed_jobs (organization_id, created_at desc);

create table public.catalog_seed_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.catalog_seed_jobs(id) on delete cascade,
  organization_id uuid not null,
  template_code text not null,
  template_version integer not null,
  item_key text not null,
  product_id uuid,
  created_at timestamptz not null default now(),
  constraint catalog_seed_items_key_check check (item_key ~ '^[a-z0-9][a-z0-9_-]{1,59}$'),
  constraint catalog_seed_items_unique unique (
    organization_id, template_code, template_version, item_key
  ),
  constraint catalog_seed_items_job_unique unique (job_id, item_key),
  constraint catalog_seed_items_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id)
    on delete set null (product_id)
);

create index catalog_seed_items_org_idx
  on public.catalog_seed_items (organization_id, template_code, template_version);

create trigger catalog_seed_jobs_set_updated_at
  before update on public.catalog_seed_jobs
  for each row execute function app.set_updated_at();

alter table public.catalog_seed_jobs enable row level security;
alter table public.catalog_seed_items enable row level security;

revoke all on public.catalog_seed_jobs from anon, authenticated;
revoke all on public.catalog_seed_items from anon, authenticated;
grant all on public.catalog_seed_jobs to service_role;
grant all on public.catalog_seed_items to service_role;

create or replace function public.api_seed_catalog(
  p_job_id uuid,
  p_organization_id uuid,
  p_actor_id uuid,
  p_template_code text,
  p_template_version integer,
  p_items jsonb
)
returns table (
  job_id uuid,
  status text,
  total_items integer,
  created_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.catalog_seed_jobs;
  v_item jsonb;
  v_key text;
  v_name text;
  v_category text;
  v_unit text;
  v_min integer;
  v_inc integer;
  v_category_id uuid;
  v_product_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_total integer := 0;
begin
  if p_job_id is null then
    raise exception 'invalid_seed_job' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  end if;
  if p_organization_id is null
     or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'invalid_organization' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  end if;
  if p_actor_id is null
     or not exists (select 1 from auth.users u where u.id = p_actor_id) then
    raise exception 'invalid_actor' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  end if;
  if p_template_code is null or p_template_code !~ '^[a-z][a-z0-9_]{2,40}$' then
    raise exception 'invalid_template' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  end if;
  if p_template_version is null or p_template_version < 1 then
    raise exception 'invalid_template_version' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_seed_items' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  end if;
  v_total := jsonb_array_length(p_items);
  if v_total > 50 then
    raise exception 'seed_item_limit' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  end if;

  select * into v_existing
    from public.catalog_seed_jobs j
   where j.id = p_job_id
   for update;

  if found then
    if v_existing.organization_id <> p_organization_id then
      raise exception 'seed_job_tenant_mismatch' using errcode = '42501';
    end if;
    if v_existing.status = 'completed' then -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
      return query select
        v_existing.id,
        v_existing.status,
        v_existing.total_items,
        v_existing.created_count,
        v_existing.skipped_count;
      return;
    end if;
  else
    insert into public.catalog_seed_jobs
      (id, organization_id, actor_user_id, template_code, template_version, status, total_items)
    values
      (p_job_id, p_organization_id, p_actor_id, p_template_code, p_template_version, 'completed', v_total); -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_key := btrim(coalesce(v_item->>'item_key', ''));
    v_name := btrim(coalesce(v_item->>'name', ''));
    v_category := btrim(coalesce(v_item->>'category', ''));
    v_unit := btrim(coalesce(v_item->>'unit', ''));
    v_min := coalesce((v_item->>'min_quantity')::integer, 1);
    v_inc := coalesce((v_item->>'quantity_increment')::integer, 1);

    if v_key !~ '^[a-z0-9][a-z0-9_-]{1,59}$' then
      raise exception 'invalid_seed_item_key' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
    end if;
    if char_length(v_name) < 1 or char_length(v_name) > 120 or v_name ~ '[<>]' then
      raise exception 'invalid_seed_item_name' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
    end if;
    if char_length(v_category) < 1 or char_length(v_category) > 80 or v_category ~ '[<>]' then
      raise exception 'invalid_seed_item_category' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
    end if;
    if char_length(v_unit) < 1 or char_length(v_unit) > 20 or v_unit ~ '[<>]' then
      raise exception 'invalid_seed_item_unit' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
    end if;
    if v_min < 1 or v_min > 999 or v_inc < 1 or v_inc > 999 or v_min % v_inc <> 0 then
      raise exception 'invalid_seed_item_quantity' using errcode = '22023'; -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
    end if;

    if exists (
      select 1 from public.catalog_seed_items s
       where s.organization_id = p_organization_id
         and s.template_code = p_template_code
         and s.template_version = p_template_version
         and s.item_key = v_key
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select p.id into v_product_id
      from public.products p
     where p.organization_id = p_organization_id
       and lower(p.name) = lower(v_name)
     limit 1;

    if found then
      insert into public.catalog_seed_items
        (job_id, organization_id, template_code, template_version, item_key, product_id)
      values
        (p_job_id, p_organization_id, p_template_code, p_template_version, v_key, v_product_id)
      on conflict do nothing;
      v_skipped := v_skipped + 1;
      continue;
    end if;

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

    insert into public.products (
      organization_id, name, unit, price_cents, active,
      min_quantity, quantity_increment, category_id
    ) values (
      p_organization_id, v_name, v_unit, null, true,
      v_min, v_inc, v_category_id
    )
    returning id into v_product_id;

    insert into public.catalog_seed_items
      (job_id, organization_id, template_code, template_version, item_key, product_id)
    values
      (p_job_id, p_organization_id, p_template_code, p_template_version, v_key, v_product_id);

    v_created := v_created + 1;
  end loop;

  update public.catalog_seed_jobs
     set created_count = v_created,
         skipped_count = v_skipped,
         total_items = v_total
   where id = p_job_id;

  return query select
    p_job_id,
    'completed'::text, -- NOSONAR: literal de contrato do seed/errcode; migration testada por DB/restore.
    v_total,
    v_created,
    v_skipped;
end;
$$;

revoke all on function public.api_seed_catalog(uuid, uuid, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.api_seed_catalog(uuid, uuid, uuid, text, integer, jsonb) to service_role;
