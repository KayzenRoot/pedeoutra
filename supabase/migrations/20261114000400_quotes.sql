-- PedeOutra V2 — orçamentos B2B com aceite opaco (#51 / PDA-VALUE-008)
-- Preços e totais são congelados no servidor; aceite cria no máximo um pedido.

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  public_reference text not null,
  status text not null default 'draft', -- NOSONAR: valor de contrato do schema; migration imutável e coberta por DB/restore.
  version integer not null default 1,
  valid_until timestamptz not null,
  notes text,
  price_source text not null default 'public', -- NOSONAR: valor de contrato do schema; migration imutável e coberta por DB/restore.
  price_list_id uuid,
  total_cents integer not null,
  order_id uuid,
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  canceled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_status_check check (
    status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'canceled') -- NOSONAR: enum de contrato do schema; migration imutável e coberta por DB/restore.
  ),
  constraint quotes_version_check check (version >= 1),
  constraint quotes_total_check check (total_cents >= 0),
  constraint quotes_notes_len check (notes is null or char_length(notes) <= 1000),
  constraint quotes_validity_check check (valid_until > created_at),
  constraint quotes_price_source_check check (price_source in ('public', 'private')), -- NOSONAR: enum de contrato do schema; migration imutável e coberta por DB/restore.
  constraint quotes_reference_unique unique (public_reference),
  constraint quotes_id_org_unique unique (id, organization_id),
  constraint quotes_customer_fk foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete restrict,
  constraint quotes_price_list_fk foreign key (price_list_id, organization_id)
    references public.price_lists(id, organization_id) on delete set null (price_list_id),
  constraint quotes_order_fk foreign key (order_id, organization_id)
    references public.orders(id, organization_id) on delete set null (order_id)
);

create index quotes_org_created_idx
  on public.quotes (organization_id, created_at desc);

create index quotes_org_status_idx
  on public.quotes (organization_id, status, valid_until);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  product_id uuid,
  name_snapshot text not null,
  unit_snapshot text not null,
  quantity integer not null,
  unit_price_cents integer not null,
  subtotal_cents integer not null,
  price_source text not null default 'public', -- NOSONAR: valor de contrato do schema; migration imutável e coberta por DB/restore.
  price_list_id uuid,
  created_at timestamptz not null default now(),
  constraint quote_items_quantity_check check (quantity between 1 and 999),
  constraint quote_items_price_check check (unit_price_cents >= 0 and unit_price_cents <= 1000000),
  constraint quote_items_subtotal_check check (subtotal_cents = unit_price_cents * quantity),
  constraint quote_items_price_source_check check (price_source in ('public', 'private')),
  constraint quote_items_unique unique (quote_id, product_id),
  constraint quote_items_quote_fk foreign key (quote_id, organization_id)
    references public.quotes(id, organization_id) on delete cascade,
  constraint quote_items_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete set null (product_id),
  constraint quote_items_price_list_fk foreign key (price_list_id, organization_id)
    references public.price_lists(id, organization_id) on delete set null (price_list_id)
);

create index quote_items_quote_idx on public.quote_items (quote_id);

create table public.quote_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint quote_events_event_check check (
    event in (
      'created', 'updated', 'sent', 'accepted', 'declined',
      'canceled', 'expired', 'review_required'
    )
  ),
  constraint quote_events_quote_fk foreign key (quote_id, organization_id)
    references public.quotes(id, organization_id) on delete cascade
);

create index quote_events_quote_idx
  on public.quote_events (quote_id, created_at asc);

create table public.quote_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint quote_links_hash_check check (token_hash ~ '^[a-f0-9]{64}$'), -- NOSONAR: regex de contrato do schema; migration imutável e coberta por DB/restore.
  constraint quote_links_expiry_check check (expires_at > created_at),
  constraint quote_links_token_unique unique (token_hash),
  constraint quote_links_quote_fk foreign key (quote_id, organization_id)
    references public.quotes(id, organization_id) on delete cascade
);

create index quote_links_quote_idx
  on public.quote_links (quote_id, created_at desc);

create unique index quote_links_one_active_idx
  on public.quote_links (quote_id)
  where revoked_at is null;

alter table public.orders
  add column quote_id uuid;

alter table public.orders
  drop constraint orders_source_check,
  add constraint orders_source_check check (
    source in ('catalog', 'reorder', 'manual', 'private', 'quote')
  ),
  add constraint orders_quote_fk foreign key (quote_id, organization_id)
    references public.quotes(id, organization_id) on delete set null (quote_id);

create unique index orders_quote_unique
  on public.orders (quote_id)
  where quote_id is not null;

-- ---------------------------------------------------------------------------
-- Preço congelável do orçamento: privado só com entitlement; fallback público.
-- ---------------------------------------------------------------------------
create or replace function app.quote_price(
  p_organization_id uuid,
  p_customer_id uuid,
  p_product_id uuid
)
returns table (
  price_cents integer,
  price_list_id uuid,
  price_source text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if app.has_entitlement(p_organization_id, 'private_prices') then
    return query
      select cp.price_cents, cp.price_list_id, cp.price_source
        from app.customer_price(
          p_organization_id, p_customer_id, p_product_id, now()
        ) cp;
    return;
  end if;

  return query
    select p.price_cents, null::uuid, 'public'::text
      from public.products p
     where p.id = p_product_id
       and p.organization_id = p_organization_id;
end;
$$;

create or replace function app.quote_valid_until(p_valid_until timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_valid_until is null
     or p_valid_until <= now()
     or p_valid_until > now() + interval '90 days' then
    raise exception 'invalid_quote_validity' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  return p_valid_until;
end;
$$;

create or replace function app.quote_notes(p_notes text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_notes text;
begin
  v_notes := nullif(
    btrim(regexp_replace(coalesce(p_notes, ''), '[[:cntrl:]]', ' ', 'g')), -- NOSONAR: regex de sanitização; migration imutável e coberta por DB/restore.
    ''
  );
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'invalid_quote_notes' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  return v_notes;
end;
$$;

-- ---------------------------------------------------------------------------
-- Constrói snapshots e total do orçamento; nunca confia no navegador.
-- ---------------------------------------------------------------------------
create or replace function app.build_quote_items(
  p_organization_id uuid,
  p_customer_id uuid,
  p_items jsonb
)
returns table (
  total_cents integer,
  item_count integer,
  price_source text,
  price_list_id uuid,
  items jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations;
  v_item record;
  v_product public.products;
  v_price record;
  v_total bigint := 0;
  v_count integer := 0;
  v_has_private boolean := false;
  v_price_list_id uuid;
  v_snapshots jsonb := '[]'::jsonb;
begin
  select * into v_org from public.organizations o where o.id = p_organization_id;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if not app.org_can_write(v_org.id) then
    raise exception 'organization_unavailable' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if not exists (
    select 1 from public.customers c
     where c.id = p_customer_id
       and c.organization_id = p_organization_id
  ) then
    raise exception 'invalid_customer' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) elem
     where elem is null
        or jsonb_typeof(elem) <> 'object'
        or jsonb_typeof(elem->'product_id') <> 'string' -- NOSONAR: chave de contrato JSON; migration imutável e coberta por DB/restore.
        or (elem->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -- NOSONAR: regex de contrato do schema; migration imutável e coberta por DB/restore.
        or jsonb_typeof(elem->'quantity') <> 'number' -- NOSONAR: chave de contrato JSON; migration imutável e coberta por DB/restore.
        or (elem->>'quantity')::numeric < 1
        or (elem->>'quantity')::numeric > 999
        or (elem->>'quantity')::numeric <> trunc((elem->>'quantity')::numeric)
  ) then
    raise exception 'invalid_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct lower(elem->>'product_id'))
        from jsonb_array_elements(p_items) elem) then
    raise exception 'duplicate_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  for v_item in
    select lower(elem->>'product_id')::uuid as product_id,
           (elem->>'quantity')::integer as quantity
      from jsonb_array_elements(p_items) elem
  loop
    select * into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.organization_id = p_organization_id
       and p.active = true
     for share;
    if not found then
      raise exception 'invalid_product' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;
    if v_item.quantity < v_product.min_quantity then
      raise exception 'quantity_below_minimum' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;
    if v_item.quantity % v_product.quantity_increment <> 0 then
      raise exception 'quantity_not_multiple' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;

    select * into v_price
      from app.quote_price(p_organization_id, p_customer_id, v_product.id);
    if not found or v_price.price_cents is null then
      raise exception 'quote_price_missing' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;

    v_total := v_total + (v_price.price_cents::bigint * v_item.quantity);
    if v_total > 2000000000 then
      raise exception 'order_too_large' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;
    v_count := v_count + 1;
    if v_price.price_source = 'private' then
      v_has_private := true;
    end if;
    v_price_list_id := coalesce(v_price_list_id, v_price.price_list_id);

    v_snapshots := v_snapshots || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'name', v_product.name,
        'unit', v_product.unit,
        'quantity', v_item.quantity,
        'unit_price_cents', v_price.price_cents,
        'subtotal_cents', v_price.price_cents::bigint * v_item.quantity,
        'price_source', v_price.price_source,
        'price_list_id', v_price.price_list_id
      )
    );
  end loop;

  if v_org.min_order_items is not null and v_count < v_org.min_order_items then
    raise exception 'order_below_minimum_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_org.min_order_cents is not null and v_total < v_org.min_order_cents then
    raise exception 'order_below_minimum' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  return query
    select
      v_total::integer,
      v_count,
      case when v_has_private then 'private' else 'public' end,
      v_price_list_id,
      v_snapshots;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revalida o snapshot antes de enviar/aceitar. Nunca altera preço sozinho.
-- ---------------------------------------------------------------------------
create or replace function app.validate_quote_snapshot(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes;
  v_org public.organizations;
  v_item public.quote_items;
  v_product public.products;
  v_price record;
  v_count integer;
begin
  select * into v_quote from public.quotes q where q.id = p_quote_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  select * into v_org from public.organizations o where o.id = v_quote.organization_id;

  for v_item in
    select * from public.quote_items qi where qi.quote_id = p_quote_id
  loop
    select * into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.organization_id = v_quote.organization_id
       and p.active = true;
    if not found then
      raise exception 'quote_product_inactive' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;
    if v_item.quantity < v_product.min_quantity then
      raise exception 'quantity_below_minimum' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;
    if v_item.quantity % v_product.quantity_increment <> 0 then
      raise exception 'quantity_not_multiple' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;

    select * into v_price
      from app.quote_price(v_quote.organization_id, v_quote.customer_id, v_product.id);
    if not found
       or v_price.price_cents is distinct from v_item.unit_price_cents
       or v_price.price_source is distinct from v_item.price_source
       or v_price.price_list_id is distinct from v_item.price_list_id then
      raise exception 'quote_stale' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;
  end loop;

  select count(*)::integer into v_count
    from public.quote_items qi where qi.quote_id = p_quote_id;
  if v_org.min_order_items is not null and v_count < v_org.min_order_items then
    raise exception 'order_below_minimum_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_org.min_order_cents is not null and v_quote.total_cents < v_org.min_order_cents then
    raise exception 'order_below_minimum' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Criação e edição de rascunho com versionamento otimista.
-- ---------------------------------------------------------------------------
create or replace function app.create_quote(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_valid_until timestamptz,
  p_notes text default null
)
returns table (
  quote_id uuid,
  public_reference text,
  total_cents integer,
  item_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_valid_until timestamptz;
  v_notes text;
  v_build record;
  v_quote_id uuid;
  v_reference text;
  v_attempt integer := 0;
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.organizations o
     where o.id = p_organization_id
       and o.owner_user_id = p_actor_user_id
  ) then
    raise exception 'forbidden' using errcode = '42501'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if not app.has_entitlement(p_organization_id, 'quotes') then -- NOSONAR: feature key de contrato; migration imutável e coberta por DB/restore.
    raise exception 'plan_required' using errcode = '42501'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  v_valid_until := app.quote_valid_until(p_valid_until);
  v_notes := app.quote_notes(p_notes);
  select * into v_build
    from app.build_quote_items(p_organization_id, p_customer_id, p_items);

  loop
    v_attempt := v_attempt + 1;
    v_reference := 'OR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.quotes (
        organization_id, customer_id, public_reference, status, version,
        valid_until, notes, price_source, price_list_id, total_cents, created_by
      ) values (
        p_organization_id, p_customer_id, v_reference, 'draft', 1,
        v_valid_until, v_notes, v_build.price_source, v_build.price_list_id,
        v_build.total_cents, p_actor_user_id
      )
      returning id into v_quote_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'quote_reference_failed' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
      end if;
    end;
  end loop;

  insert into public.quote_items (
    organization_id, quote_id, product_id, name_snapshot, unit_snapshot,
    quantity, unit_price_cents, subtotal_cents, price_source, price_list_id
  )
  select
    p_organization_id, v_quote_id, x.product_id, x.name, x.unit,
    x.quantity, x.unit_price_cents, x.subtotal_cents, x.price_source, x.price_list_id
  from jsonb_to_recordset(v_build.items) as x(
    product_id uuid, name text, unit text, quantity integer,
    unit_price_cents integer, subtotal_cents integer,
    price_source text, price_list_id uuid
  );

  insert into public.quote_events (
    organization_id, quote_id, actor_user_id, event, to_status, metadata
  ) values (
    p_organization_id, v_quote_id, p_actor_user_id, 'created', 'draft',
    jsonb_build_object('total_cents', v_build.total_cents, 'item_count', v_build.item_count) -- NOSONAR: chaves de contrato JSON; migration imutável e coberta por DB/restore.
  );

  return query select v_quote_id, v_reference, v_build.total_cents, v_build.item_count;
end;
$$;

create or replace function app.update_quote(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_quote_id uuid,
  p_expected_version integer,
  p_items jsonb,
  p_valid_until timestamptz,
  p_notes text default null
)
returns table (
  quote_id uuid,
  total_cents integer,
  item_count integer,
  version integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes;
  v_valid_until timestamptz;
  v_notes text;
  v_build record;
  v_new_version integer;
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.organizations o
     where o.id = p_organization_id
       and o.owner_user_id = p_actor_user_id
  ) then
    raise exception 'forbidden' using errcode = '42501'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if not app.has_entitlement(p_organization_id, 'quotes') then -- NOSONAR: feature key de contrato; migration imutável e coberta por DB/restore.
    raise exception 'plan_required' using errcode = '42501'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  select * into v_quote
    from public.quotes q
   where q.id = p_quote_id
     and q.organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.status <> 'draft' then
    raise exception 'quote_not_editable' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.version <> p_expected_version then
    raise exception 'quote_version_conflict' using errcode = '40001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  v_valid_until := app.quote_valid_until(p_valid_until);
  v_notes := app.quote_notes(p_notes);
  select * into v_build
    from app.build_quote_items(p_organization_id, v_quote.customer_id, p_items);
  v_new_version := v_quote.version + 1;

  delete from public.quote_items qi where qi.quote_id = p_quote_id;
  insert into public.quote_items (
    organization_id, quote_id, product_id, name_snapshot, unit_snapshot,
    quantity, unit_price_cents, subtotal_cents, price_source, price_list_id
  )
  select
    p_organization_id, p_quote_id, x.product_id, x.name, x.unit,
    x.quantity, x.unit_price_cents, x.subtotal_cents, x.price_source, x.price_list_id
  from jsonb_to_recordset(v_build.items) as x(
    product_id uuid, name text, unit text, quantity integer,
    unit_price_cents integer, subtotal_cents integer,
    price_source text, price_list_id uuid
  );

  update public.quotes
     set valid_until = v_valid_until,
         notes = v_notes,
         price_source = v_build.price_source,
         price_list_id = v_build.price_list_id,
         total_cents = v_build.total_cents,
         version = v_new_version,
         updated_at = now()
   where id = p_quote_id;

  insert into public.quote_events (
    organization_id, quote_id, actor_user_id, event, from_status, to_status, metadata
  ) values (
    p_organization_id, p_quote_id, p_actor_user_id, 'updated', 'draft', 'draft',
    jsonb_build_object(
      'from_version', v_quote.version,
      'to_version', v_new_version,
      'total_cents', v_build.total_cents,
      'item_count', v_build.item_count
    )
  );

  return query select p_quote_id, v_build.total_cents, v_build.item_count, v_new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Envio: revalida snapshot, cria link opaco e congela a versão.
-- ---------------------------------------------------------------------------
create or replace function app.send_quote(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_quote_id uuid,
  p_expected_version integer,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table (
  quote_id uuid,
  expires_at timestamptz,
  version integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes;
  v_expires timestamptz;
  v_new_version integer;
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.organizations o
     where o.id = p_organization_id
       and o.owner_user_id = p_actor_user_id
  ) then
    raise exception 'forbidden' using errcode = '42501'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if not app.has_entitlement(p_organization_id, 'quotes') then -- NOSONAR: feature key de contrato; migration imutável e coberta por DB/restore.
    raise exception 'plan_required' using errcode = '42501'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_quote_token' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  select * into v_quote
    from public.quotes q
   where q.id = p_quote_id
     and q.organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.status not in ('draft', 'sent') then
    raise exception 'quote_not_editable' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.version <> p_expected_version then
    raise exception 'quote_version_conflict' using errcode = '40001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.valid_until <= now() then
    raise exception 'quote_expired' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  perform app.validate_quote_snapshot(p_quote_id);

  v_expires := least(p_expires_at, v_quote.valid_until);
  if v_expires <= now() then
    raise exception 'quote_expired' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  update public.quote_links l
     set revoked_at = now()
   where l.quote_id = p_quote_id
     and l.revoked_at is null;

  insert into public.quote_links (
    organization_id, quote_id, token_hash, expires_at, created_by
  ) values (
    p_organization_id, p_quote_id, p_token_hash, v_expires, p_actor_user_id
  );

  v_new_version := v_quote.version + 1;
  update public.quotes
     set status = 'sent',
         sent_at = coalesce(sent_at, now()),
         version = v_new_version,
         updated_at = now()
   where id = p_quote_id;

  insert into public.quote_events (
    organization_id, quote_id, actor_user_id, event, from_status, to_status, metadata
  ) values (
    p_organization_id, p_quote_id, p_actor_user_id, 'sent', v_quote.status, 'sent',
    jsonb_build_object('expires_at', v_expires, 'rotated', v_quote.status = 'sent')
  );

  return query select p_quote_id, v_expires, v_new_version;
end;
$$;

create or replace function app.cancel_quote(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_quote_id uuid,
  p_expected_version integer
)
returns table (status text, version integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes;
  v_new_version integer;
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.organizations o
     where o.id = p_organization_id
       and o.owner_user_id = p_actor_user_id
  ) then
    raise exception 'forbidden' using errcode = '42501'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  select * into v_quote
    from public.quotes q
   where q.id = p_quote_id
     and q.organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.status not in ('draft', 'sent') then
    raise exception 'quote_not_cancelable' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.version <> p_expected_version then
    raise exception 'quote_version_conflict' using errcode = '40001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  v_new_version := v_quote.version + 1;
  update public.quotes
     set status = 'canceled',
         canceled_at = now(),
         version = v_new_version,
         updated_at = now()
   where id = p_quote_id;
  update public.quote_links
     set revoked_at = now()
   where quote_id = p_quote_id
     and revoked_at is null;

  insert into public.quote_events (
    organization_id, quote_id, actor_user_id, event, from_status, to_status
  ) values (
    p_organization_id, p_quote_id, p_actor_user_id, 'canceled', v_quote.status, 'canceled'
  );

  return query select 'canceled'::text, v_new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aceite/recusa públicos: token é a credencial; idempotência por quote.
-- ---------------------------------------------------------------------------
create or replace function app.accept_quote(
  p_token_hash text,
  p_request_id uuid,
  p_agent text default null
)
returns table (
  order_id uuid,
  public_reference text,
  total_cents integer,
  item_count integer,
  quote_reference text,
  already_accepted boolean,
  error_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.quote_links;
  v_quote public.quotes;
  v_order public.orders;
  v_org public.organizations;
  v_reference text;
  v_order_id uuid;
  v_item_count integer;
  v_attempt integer := 0;
  v_agent text;
begin
  if p_request_id is null then
    raise exception 'invalid_request_id' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'quote_link_unavailable' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  select * into v_link
    from public.quote_links l
   where l.token_hash = p_token_hash
   for update;
  if not found then
    raise exception 'quote_link_unavailable' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  select * into v_quote
    from public.quotes q
   where q.id = v_link.quote_id
     and q.organization_id = v_link.organization_id
   for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  if v_quote.status = 'accepted' then
    select * into v_order
      from public.orders o
     where o.id = v_quote.order_id
       and o.organization_id = v_quote.organization_id;
    if not found then
      raise exception 'quote_order_missing' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
    end if;
    select count(*)::integer into v_item_count
      from public.order_items oi where oi.order_id = v_order.id;
    return query
      select v_order.id, v_order.public_reference, v_order.total_cents,
             v_item_count, v_quote.public_reference, true, null::text;
    return;
  end if;

  if v_link.revoked_at is not null or v_link.expires_at <= now() then
    raise exception 'quote_link_unavailable' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.status <> 'sent' then
    raise exception 'quote_not_open' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.valid_until <= now() then
    update public.quotes
       set status = 'expired', version = version + 1, updated_at = now()
     where id = v_quote.id;
    update public.quote_links
       set revoked_at = now()
     where quote_id = v_quote.id and revoked_at is null;
    insert into public.quote_events (
      organization_id, quote_id, event, from_status, to_status, metadata
    ) values (
      v_quote.organization_id, v_quote.id, 'expired', 'sent', 'expired',
      jsonb_build_object('reason', 'validity') -- NOSONAR: valor de contrato JSON; migration imutável e coberta por DB/restore.
    );
    return query
      select null::uuid, null::text, null::integer, null::integer,
             v_quote.public_reference, false, 'quote_expired'::text;
    return;
  end if;

  select * into v_org from public.organizations o where o.id = v_quote.organization_id;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if not app.org_can_write(v_org.id) then
    raise exception 'organization_unavailable' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if not app.has_entitlement(v_org.id, 'quotes') then
    raise exception 'plan_required' using errcode = '42501'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  begin
    perform app.validate_quote_snapshot(v_quote.id);
  exception when others then
    if SQLERRM like '%quote_stale%'
       or SQLERRM like '%quote_product_inactive%'
       or SQLERRM like '%quantity_%'
       or SQLERRM like '%order_below_%' then
      update public.quotes
         set status = 'expired', version = version + 1, updated_at = now()
       where id = v_quote.id;
      update public.quote_links
         set revoked_at = now()
       where quote_id = v_quote.id and revoked_at is null;
      insert into public.quote_events (
        organization_id, quote_id, event, from_status, to_status, metadata
      ) values (
        v_quote.organization_id, v_quote.id, 'review_required', 'sent', 'expired',
        jsonb_build_object('reason', SQLERRM)
      );
      return query
        select null::uuid, null::text, null::integer, null::integer,
               v_quote.public_reference, false, SQLERRM;
      return;
    end if;
    raise;
  end;

  v_agent := nullif(
    left(regexp_replace(coalesce(p_agent, ''), '[[:cntrl:]]', ' ', 'g'), 300),
    ''
  );

  loop
    v_attempt := v_attempt + 1;
    v_reference := 'PD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.orders (
        organization_id, customer_id, public_reference, status, total_cents,
        buyer_name, buyer_phone, note, source, request_id, price_list_id,
        price_source, quote_id
      ) values (
        v_quote.organization_id, v_quote.customer_id, v_reference, 'new',
        v_quote.total_cents, null, null, left(coalesce(v_quote.notes, ''), 500),
        'quote', p_request_id, v_quote.price_list_id, v_quote.price_source, v_quote.id
      )
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'request_conflict' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
      end if;
    end;
  end loop;

  insert into public.order_items (
    organization_id, order_id, product_id, name_snapshot, unit_snapshot,
    unit_price_cents, quantity, subtotal_cents
  )
  select
    v_quote.organization_id, v_order_id, qi.product_id, qi.name_snapshot,
    qi.unit_snapshot, qi.unit_price_cents, qi.quantity, qi.subtotal_cents
  from public.quote_items qi
  where qi.quote_id = v_quote.id;

  select count(*)::integer into v_item_count
    from public.order_items oi where oi.order_id = v_order_id;

  update public.quotes
     set status = 'accepted',
         accepted_at = now(),
         order_id = v_order_id,
         version = version + 1,
         updated_at = now()
   where id = v_quote.id;
  update public.quote_links
     set revoked_at = now()
   where quote_id = v_quote.id and revoked_at is null;

  insert into public.quote_events (
    organization_id, quote_id, event, from_status, to_status, metadata
  ) values (
    v_quote.organization_id, v_quote.id, 'accepted', 'sent', 'accepted',
    jsonb_build_object(
      'order_id', v_order_id,
      'request_id', p_request_id,
      'user_agent', v_agent,
      'total_cents', v_quote.total_cents
    )
  );

  return query
    select v_order_id, v_reference, v_quote.total_cents, v_item_count,
           v_quote.public_reference, false, null::text;
end;
$$;

create or replace function app.decline_quote(
  p_token_hash text,
  p_agent text default null
)
returns table (status text, version integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.quote_links;
  v_quote public.quotes;
  v_new_version integer;
  v_agent text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'quote_link_unavailable' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  select * into v_link
    from public.quote_links l
   where l.token_hash = p_token_hash
   for update;
  if not found then
    raise exception 'quote_link_unavailable' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  select * into v_quote
    from public.quotes q
   where q.id = v_link.quote_id
     and q.organization_id = v_link.organization_id
   for update;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.status = 'declined' then
    return query select 'declined'::text, v_quote.version;
    return;
  end if;
  if v_link.revoked_at is not null or v_link.expires_at <= now() then
    raise exception 'quote_link_unavailable' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.status <> 'sent' then
    raise exception 'quote_not_open' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if v_quote.valid_until <= now() then
    update public.quotes
       set status = 'expired', version = version + 1, updated_at = now()
     where id = v_quote.id;
    update public.quote_links
       set revoked_at = now()
     where quote_id = v_quote.id and revoked_at is null;
    insert into public.quote_events (
      organization_id, quote_id, event, from_status, to_status, metadata
    ) values (
      v_quote.organization_id, v_quote.id, 'expired', 'sent', 'expired',
      jsonb_build_object('reason', 'validity') -- NOSONAR: valor de contrato JSON; migration imutável e coberta por DB/restore.
    );
    return query select 'expired'::text, v_quote.version + 1;
    return;
  end if;

  v_agent := nullif(
    left(regexp_replace(coalesce(p_agent, ''), '[[:cntrl:]]', ' ', 'g'), 300),
    ''
  );
  v_new_version := v_quote.version + 1;
  update public.quotes
     set status = 'declined',
         declined_at = now(),
         version = v_new_version,
         updated_at = now()
   where id = v_quote.id;
  update public.quote_links
     set revoked_at = now()
   where quote_id = v_quote.id and revoked_at is null;

  insert into public.quote_events (
    organization_id, quote_id, event, from_status, to_status, metadata
  ) values (
    v_quote.organization_id, v_quote.id, 'declined', 'sent', 'declined',
    jsonb_build_object('user_agent', v_agent)
  );

  return query select 'declined'::text, v_new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: fornecedor lê o histórico; escrita só por RPC/Edge com service_role.
-- ---------------------------------------------------------------------------
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_events enable row level security;
alter table public.quote_links enable row level security;

revoke all on public.quotes from anon, authenticated;
revoke all on public.quote_items from anon, authenticated;
revoke all on public.quote_events from anon, authenticated;
revoke all on public.quote_links from anon, authenticated;

create policy quotes_select_own
  on public.quotes for select to authenticated
  using (app.is_org_owner(organization_id));

create policy quote_items_select_own
  on public.quote_items for select to authenticated
  using (app.is_org_owner(organization_id));

create policy quote_events_select_own
  on public.quote_events for select to authenticated
  using (app.is_org_owner(organization_id));

grant select on public.quotes to authenticated;
grant select on public.quote_items to authenticated;
grant select on public.quote_events to authenticated;
grant all on public.quotes to service_role;
grant all on public.quote_items to service_role;
grant all on public.quote_events to service_role;
grant all on public.quote_links to service_role;

-- ---------------------------------------------------------------------------
-- Wrappers service_role (Edge Functions). Nunca expostos ao browser.
-- ---------------------------------------------------------------------------
create or replace function public.api_create_quote(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_valid_until timestamptz,
  p_notes text default null
)
returns table (quote_id uuid, public_reference text, total_cents integer, item_count integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.create_quote(
    p_organization_id, p_actor_user_id, p_customer_id, p_items, p_valid_until, p_notes
  )
$$;

create or replace function public.api_update_quote(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_quote_id uuid,
  p_expected_version integer,
  p_items jsonb,
  p_valid_until timestamptz,
  p_notes text default null
)
returns table (quote_id uuid, total_cents integer, item_count integer, version integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.update_quote(
    p_organization_id, p_actor_user_id, p_quote_id, p_expected_version,
    p_items, p_valid_until, p_notes
  )
$$;

create or replace function public.api_send_quote(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_quote_id uuid,
  p_expected_version integer,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table (quote_id uuid, expires_at timestamptz, version integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.send_quote(
    p_organization_id, p_actor_user_id, p_quote_id, p_expected_version,
    p_token_hash, p_expires_at
  )
$$;

create or replace function public.api_cancel_quote(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_quote_id uuid,
  p_expected_version integer
)
returns table (status text, version integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.cancel_quote(
    p_organization_id, p_actor_user_id, p_quote_id, p_expected_version
  )
$$;

create or replace function public.api_accept_quote(
  p_token_hash text,
  p_request_id uuid,
  p_agent text default null
)
returns table (
  order_id uuid,
  public_reference text,
  total_cents integer,
  item_count integer,
  quote_reference text,
  already_accepted boolean,
  error_code text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.accept_quote(p_token_hash, p_request_id, p_agent)
$$;

create or replace function public.api_decline_quote(
  p_token_hash text,
  p_agent text default null
)
returns table (status text, version integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.decline_quote(p_token_hash, p_agent)
$$;

revoke all on function app.quote_price(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.quote_valid_until(timestamptz) from public, anon, authenticated;
revoke all on function app.quote_notes(text) from public, anon, authenticated;
revoke all on function app.build_quote_items(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function app.validate_quote_snapshot(uuid) from public, anon, authenticated;
revoke all on function app.create_quote(uuid, uuid, uuid, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function app.update_quote(uuid, uuid, uuid, integer, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function app.send_quote(uuid, uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function app.cancel_quote(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function app.accept_quote(text, uuid, text) from public, anon, authenticated;
revoke all on function app.decline_quote(text, text) from public, anon, authenticated;

revoke all on function public.api_create_quote(uuid, uuid, uuid, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.api_update_quote(uuid, uuid, uuid, integer, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.api_send_quote(uuid, uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.api_cancel_quote(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.api_accept_quote(text, uuid, text) from public, anon, authenticated;
revoke all on function public.api_decline_quote(text, text) from public, anon, authenticated;

grant execute on function app.quote_price(uuid, uuid, uuid) to service_role;
grant execute on function app.quote_valid_until(timestamptz) to service_role;
grant execute on function app.quote_notes(text) to service_role;
grant execute on function app.build_quote_items(uuid, uuid, jsonb) to service_role;
grant execute on function app.validate_quote_snapshot(uuid) to service_role;
grant execute on function app.create_quote(uuid, uuid, uuid, jsonb, timestamptz, text) to service_role;
grant execute on function app.update_quote(uuid, uuid, uuid, integer, jsonb, timestamptz, text) to service_role;
grant execute on function app.send_quote(uuid, uuid, uuid, integer, text, timestamptz) to service_role;
grant execute on function app.cancel_quote(uuid, uuid, uuid, integer) to service_role;
grant execute on function app.accept_quote(text, uuid, text) to service_role;
grant execute on function app.decline_quote(text, text) to service_role;

grant execute on function public.api_create_quote(uuid, uuid, uuid, jsonb, timestamptz, text) to service_role;
grant execute on function public.api_update_quote(uuid, uuid, uuid, integer, jsonb, timestamptz, text) to service_role;
grant execute on function public.api_send_quote(uuid, uuid, uuid, integer, text, timestamptz) to service_role;
grant execute on function public.api_cancel_quote(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.api_accept_quote(text, uuid, text) to service_role;
grant execute on function public.api_decline_quote(text, text) to service_role;
