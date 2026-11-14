-- PedeOutra V2 — tabelas de preço particulares por comprador (PDA-VALUE-005 / #48)
-- Preço privado só é liberado por token de cliente válido e entitlement Profissional.

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_lists_name_len check (char_length(name) between 1 and 80),
  constraint price_lists_id_org_unique unique (id, organization_id)
);

create unique index price_lists_org_name_unique
  on public.price_lists (organization_id, lower(name));

create trigger price_lists_set_updated_at
  before update on public.price_lists
  for each row execute function app.set_updated_at();

create table public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  price_list_id uuid not null,
  product_id uuid not null,
  price_cents integer not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  constraint price_list_items_price_check check (price_cents >= 0 and price_cents <= 1000000),
  constraint price_list_items_validity_check check (valid_until is null or valid_until > valid_from),
  constraint price_list_items_unique unique (price_list_id, product_id),
  constraint price_list_items_list_fk foreign key (price_list_id, organization_id)
    references public.price_lists(id, organization_id) on delete cascade,
  constraint price_list_items_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete cascade
);

create index price_list_items_list_idx
  on public.price_list_items (price_list_id, product_id);

create table public.customer_price_list_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  price_list_id uuid not null,
  assigned_at timestamptz not null default now(),
  constraint customer_price_list_assignments_customer_unique unique (customer_id),
  constraint customer_price_list_assignments_customer_fk foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete cascade,
  constraint customer_price_list_assignments_list_fk foreign key (price_list_id, organization_id)
    references public.price_lists(id, organization_id) on delete cascade
);

create table public.customer_price_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_price_tokens_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint customer_price_tokens_expiry_check check (expires_at > created_at),
  constraint customer_price_tokens_token_unique unique (token_hash),
  constraint customer_price_tokens_customer_fk foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete cascade
);

create index customer_price_tokens_org_customer_idx
  on public.customer_price_tokens (organization_id, customer_id, created_at desc);

create unique index customer_price_tokens_one_active_idx
  on public.customer_price_tokens (customer_id)
  where revoked_at is null;

alter table public.orders
  add column price_list_id uuid,
  add column price_source text not null default 'public';

alter table public.orders
  drop constraint orders_source_check,
  add constraint orders_source_check check (source in ('catalog', 'reorder', 'manual', 'private')),
  add constraint orders_price_source_check check (price_source in ('public', 'private')),
  add constraint orders_price_list_fk foreign key (price_list_id, organization_id)
    references public.price_lists(id, organization_id)
    on delete set null (price_list_id);

-- ---------------------------------------------------------------------------
-- RLS: leitura do histórico é permitida ao dono; escrita exige Profissional.
-- ---------------------------------------------------------------------------
-- Helper para RLS: confirma dono + entitlement sem expor app.has_entitlement.
create or replace function app.org_has_private_prices(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_org_owner(p_organization_id)
     and app.has_entitlement(p_organization_id, 'private_prices')
$$;

revoke all on function app.org_has_private_prices(uuid) from public, anon, authenticated;
grant execute on function app.org_has_private_prices(uuid) to authenticated, service_role;

alter table public.price_lists enable row level security;
alter table public.price_list_items enable row level security;
alter table public.customer_price_list_assignments enable row level security;
alter table public.customer_price_tokens enable row level security;

revoke all on public.price_lists from anon, authenticated;
revoke all on public.price_list_items from anon, authenticated;
revoke all on public.customer_price_list_assignments from anon, authenticated;
revoke all on public.customer_price_tokens from anon, authenticated;

create policy price_lists_select_own
  on public.price_lists for select to authenticated
  using (app.is_org_owner(organization_id));

create policy price_lists_write_own
  on public.price_lists for all to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id))
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id));

create policy price_list_items_select_own
  on public.price_list_items for select to authenticated
  using (app.is_org_owner(organization_id));

create policy price_list_items_write_own
  on public.price_list_items for all to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id))
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id));

create policy customer_price_assignments_select_own
  on public.customer_price_list_assignments for select to authenticated
  using (app.is_org_owner(organization_id));

create policy customer_price_assignments_write_own
  on public.customer_price_list_assignments for all to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id))
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id));

grant select, insert, update, delete on public.price_lists to authenticated;
grant select, insert, update, delete on public.price_list_items to authenticated;
grant select, insert, update, delete on public.customer_price_list_assignments to authenticated;
grant all on public.price_lists to service_role;
grant all on public.price_list_items to service_role;
grant all on public.customer_price_list_assignments to service_role;
grant all on public.customer_price_tokens to service_role;

-- ---------------------------------------------------------------------------
-- Preço efetivo do cliente: item privado válido > preço público do produto.
-- ---------------------------------------------------------------------------
create or replace function app.customer_price(
  p_organization_id uuid,
  p_customer_id uuid,
  p_product_id uuid,
  p_at timestamptz default now()
)
returns table (
  price_cents integer,
  price_list_id uuid,
  price_source text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(i.price_cents, p.price_cents),
    case when i.price_cents is not null then l.id end,
    case when i.price_cents is not null then 'private' else 'public' end
  from public.products p
  left join public.customer_price_list_assignments a
    on a.customer_id = p_customer_id
   and a.organization_id = p_organization_id
  left join public.price_lists l
    on l.id = a.price_list_id
   and l.organization_id = p_organization_id
   and l.active = true
  left join public.price_list_items i
    on i.price_list_id = l.id
   and i.product_id = p.id
   and i.organization_id = p_organization_id
   and i.valid_from <= p_at
   and (i.valid_until is null or i.valid_until > p_at)
  where p.id = p_product_id
    and p.organization_id = p_organization_id
$$;

-- ---------------------------------------------------------------------------
-- submit_order: preço privado apenas com token de cliente válido.
-- ---------------------------------------------------------------------------
drop function if exists public.api_submit_order(text, text, text, text, jsonb, text, uuid);
drop function if exists public.api_submit_reorder(text, jsonb, text, uuid, uuid);
drop function if exists app.submit_order(text, text, text, text, jsonb, text, uuid, text, uuid);

create or replace function app.submit_order(
  p_org_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_note text,
  p_items jsonb,
  p_rate_bucket text,
  p_reorder_link_id uuid default null,
  p_source text default 'catalog',
  p_request_id uuid default null,
  p_price_token text default null
)
returns table (
  order_id uuid,
  public_reference text,
  total_cents integer,
  item_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations;
  v_link public.reorder_links;
  v_item record;
  v_product public.products;
  v_price record;
  v_total bigint := 0;
  v_has_null_price boolean := false;
  v_order_id uuid;
  v_reference text;
  v_count integer := 0;
  v_attempt integer := 0;
  v_snapshots jsonb := '[]'::jsonb;
  v_existing_total integer;
  v_existing_source text;
  v_existing_customer uuid;
  v_customer_id uuid;
  v_price_list_id uuid;
  v_order_price_list_id uuid;
  v_token_hash text;
  v_unit_price integer;
begin
  if p_org_slug is null or p_org_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid_organization' using errcode = '22023';
  end if;

  select * into v_org from public.organizations o where o.slug = p_org_slug;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if not app.org_can_write(v_org.id) then
    raise exception 'organization_unavailable' using errcode = 'P0001';
  end if;

  if p_source not in ('catalog', 'reorder', 'private') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if (p_price_token is not null and p_source <> 'private')
     or (p_price_token is null and p_source = 'private') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if (p_reorder_link_id is null and p_source = 'reorder')
     or (p_reorder_link_id is not null and p_source <> 'reorder') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if p_reorder_link_id is not null and p_price_token is not null then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  if p_price_token is not null then
    if not app.has_entitlement(v_org.id, 'private_prices') then
      raise exception 'plan_required' using errcode = '42501';
    end if;
    v_token_hash := encode(extensions.digest(p_price_token, 'sha256'), 'hex');
    select t.customer_id into v_customer_id
      from public.customer_price_tokens t
     where t.organization_id = v_org.id
       and t.token_hash = v_token_hash
       and t.revoked_at is null
       and t.expires_at > now();
    if not found then
      raise exception 'invalid_price_token' using errcode = 'P0002';
    end if;
    if not app.consume_rate_limit('price-token:' || v_token_hash, 20, 600) then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    select a.price_list_id into v_price_list_id
      from public.customer_price_list_assignments a
      join public.price_lists l
        on l.id = a.price_list_id
       and l.organization_id = v_org.id
       and l.active = true
     where a.customer_id = v_customer_id
       and a.organization_id = v_org.id;
    if v_price_list_id is null then
      raise exception 'invalid_price_token' using errcode = 'P0002';
    end if;
  end if;

  if p_reorder_link_id is not null then
    select * into v_link
      from public.reorder_links l
     where l.id = p_reorder_link_id
       and l.organization_id = v_org.id
     for update;
    if not found then
      raise exception 'invalid_reorder_link' using errcode = 'P0002';
    end if;
    if v_link.revoked_at is not null or v_link.expires_at <= now() then
      raise exception 'invalid_reorder_link' using errcode = 'P0002';
    end if;
    v_customer_id := v_link.customer_id;
  end if;

  if p_request_id is not null then
    select o.id, o.public_reference, o.total_cents, o.source, o.customer_id
      into v_order_id, v_reference, v_existing_total, v_existing_source, v_existing_customer
      from public.orders o
     where o.organization_id = v_org.id
       and o.request_id = p_request_id;
    if found then
      if v_existing_source is distinct from p_source
         or (v_customer_id is not null and v_existing_customer is distinct from v_customer_id) then
        raise exception 'request_conflict' using errcode = '22023';
      end if;
      select count(*)::integer into v_count
        from public.order_items oi
       where oi.order_id = v_order_id;
      return query select v_order_id, v_reference, v_existing_total, v_count;
      return;
    end if;
  end if;

  if not app.consume_rate_limit(p_rate_bucket, 20, 600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if not app.consume_rate_limit('org:' || v_org.id::text, 120, 3600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if p_reorder_link_id is not null then
    if not app.consume_rate_limit('link:' || p_reorder_link_id::text, 20, 600) then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  if p_buyer_name is not null
     and (char_length(btrim(p_buyer_name)) < 2 or char_length(p_buyer_name) > 120) then
    raise exception 'invalid_buyer_name' using errcode = '22023';
  end if;
  if p_buyer_phone is not null and p_buyer_phone !~ '^[0-9]{10,15}$' then
    raise exception 'invalid_buyer_phone' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  if p_reorder_link_id is null and p_price_token is null
     and (p_buyer_name is null or p_buyer_phone is null) then
    raise exception 'buyer_required' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where elem is null
       or jsonb_typeof(elem) <> 'object'
       or coalesce(elem->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(elem->>'quantity', '') !~ '^[0-9]{1,3}$'
       or (elem->>'quantity')::integer < 1
       or (elem->>'quantity')::integer > 999
  ) then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct lower(elem->>'product_id')) from jsonb_array_elements(p_items) elem) then
    raise exception 'duplicate_items' using errcode = '22023';
  end if;

  for v_item in
    select lower(elem->>'product_id')::uuid as product_id,
           (elem->>'quantity')::integer as quantity
      from jsonb_array_elements(p_items) elem
  loop
    select * into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.organization_id = v_org.id
       and p.active = true
     for share;
    if not found then
      raise exception 'invalid_product' using errcode = '22023';
    end if;
    if v_item.quantity < v_product.min_quantity then
      raise exception 'quantity_below_minimum' using errcode = '22023';
    end if;
    if v_item.quantity % v_product.quantity_increment <> 0 then
      raise exception 'quantity_not_multiple' using errcode = '22023';
    end if;

    v_count := v_count + 1;
    v_unit_price := v_product.price_cents;

    if p_price_token is not null then
      select * into v_price
        from app.customer_price(v_org.id, v_customer_id, v_product.id, now());
      v_unit_price := v_price.price_cents;
      v_order_price_list_id := coalesce(v_order_price_list_id, v_price.price_list_id);
    end if;

    if v_unit_price is null then
      v_has_null_price := true;
    else
      v_total := v_total + (v_unit_price::bigint * v_item.quantity);
    end if;

    if v_total > 2000000000 then
      raise exception 'order_too_large' using errcode = '22023';
    end if;

    v_snapshots := v_snapshots || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'name', v_product.name,
        'unit', v_product.unit,
        'unit_price_cents', v_unit_price,
        'quantity', v_item.quantity,
        'subtotal_cents', case
          when v_unit_price is null then null
          else v_unit_price::bigint * v_item.quantity
        end
      )
    );
  end loop;

  if v_org.min_order_items is not null and v_count < v_org.min_order_items then
    raise exception 'order_below_minimum_items' using errcode = '22023';
  end if;
  if v_org.min_order_cents is not null then
    if v_has_null_price then
      raise exception 'minimum_unverifiable' using errcode = '22023';
    end if;
    if v_total < v_org.min_order_cents then
      raise exception 'order_below_minimum' using errcode = '22023';
    end if;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_reference := 'PD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.orders (
        organization_id, customer_id, public_reference, status, total_cents,
        buyer_name, buyer_phone, note, source, request_id, price_list_id, price_source
      ) values (
        v_org.id,
        v_customer_id,
        v_reference,
        'new',
        case when v_has_null_price then null else v_total::integer end,
        case when p_price_token is null and p_reorder_link_id is null then btrim(p_buyer_name) else null end,
        case when p_price_token is null and p_reorder_link_id is null then p_buyer_phone else null end,
        nullif(btrim(coalesce(p_note, '')), ''),
        p_source,
        p_request_id,
        v_order_price_list_id,
        case when p_price_token is not null then 'private' else 'public' end
      )
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      if p_request_id is not null then
        select o.id, o.public_reference, o.total_cents
          into v_order_id, v_reference, v_existing_total
          from public.orders o
         where o.organization_id = v_org.id
           and o.request_id = p_request_id;
        if found then
          select count(*)::integer into v_count
            from public.order_items oi
           where oi.order_id = v_order_id;
          return query select v_order_id, v_reference, v_existing_total, v_count;
          return;
        end if;
      end if;
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;

  insert into public.order_items (
    organization_id, order_id, product_id, name_snapshot, unit_snapshot,
    unit_price_cents, quantity, subtotal_cents
  )
  select
    v_org.id, v_order_id, (s->>'product_id')::uuid, s->>'name', s->>'unit',
    case when s->>'unit_price_cents' is null then null else (s->>'unit_price_cents')::integer end,
    (s->>'quantity')::integer,
    case when s->>'subtotal_cents' is null then null else (s->>'subtotal_cents')::integer end
  from jsonb_array_elements(v_snapshots) s;

  if p_reorder_link_id is not null then
    update public.reorder_links set last_used_at = now() where id = p_reorder_link_id;
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity, entity_id, metadata
  ) values (
    v_org.id, auth.uid(), 'order.created', 'order', v_order_id,
    jsonb_build_object('source', p_source, 'reference', v_reference, 'price_source',
      case when p_price_token is not null then 'private' else 'public' end)
  );

  return query select
    v_order_id, v_reference,
    case when v_has_null_price then null else v_total::integer end,
    v_count;
end;
$$;

create or replace function public.api_submit_order(
  p_org_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_note text,
  p_items jsonb,
  p_rate_bucket text,
  p_request_id uuid,
  p_price_token text default null
)
returns table (order_id uuid, public_reference text, total_cents integer, item_count integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.submit_order(
    p_org_slug, p_buyer_name, p_buyer_phone, p_note, p_items,
    p_rate_bucket, null,
    case when p_price_token is null then 'catalog' else 'private' end,
    p_request_id, p_price_token
  )
$$;

create or replace function public.api_submit_reorder(
  p_org_slug text,
  p_items jsonb,
  p_rate_bucket text,
  p_link_id uuid,
  p_request_id uuid
)
returns table (order_id uuid, public_reference text, total_cents integer, item_count integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.submit_order(
    p_org_slug, null, null, null, p_items,
    p_rate_bucket, p_link_id, 'reorder', p_request_id, null
  )
$$;

revoke all on function app.customer_price(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.submit_order(text, text, text, text, jsonb, text, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.api_submit_order(text, text, text, text, jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function public.api_submit_reorder(text, jsonb, text, uuid, uuid) from public, anon, authenticated;
grant execute on function app.customer_price(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function app.submit_order(text, text, text, text, jsonb, text, uuid, text, uuid, text) to service_role;
grant execute on function public.api_submit_order(text, text, text, text, jsonb, text, uuid, text) to service_role;
grant execute on function public.api_submit_reorder(text, jsonb, text, uuid, uuid) to service_role;
