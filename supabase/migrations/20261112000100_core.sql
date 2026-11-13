-- PedeOutra — core schema (PDA-MVP-WO-001)
-- Tabelas, constraints, índices e triggers. RLS e grants ficam na migration seguinte.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Organizações (uma por conta no MVP)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  whatsapp text not null,
  city text,
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  access_state text not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_len check (char_length(name) between 2 and 120),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organizations_whatsapp_format check (whatsapp ~ '^[0-9]{10,15}$'),
  constraint organizations_city_len check (city is null or char_length(city) <= 80),
  constraint organizations_access_state check (access_state in ('trial', 'active', 'blocked')),
  constraint organizations_owner_unique unique (owner_user_id),
  constraint organizations_slug_unique unique (slug)
);

-- ---------------------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  unit text not null,
  price_cents integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_len check (char_length(name) between 1 and 120),
  constraint products_unit_len check (char_length(unit) between 1 and 20),
  constraint products_price_range check (price_cents is null or (price_cents >= 0 and price_cents <= 1000000)),
  constraint products_id_org_unique unique (id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Clientes comerciais (dados privados do tenant)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  contact_phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_len check (char_length(display_name) between 1 and 120),
  constraint customers_phone_format check (contact_phone ~ '^[0-9]{10,15}$'),
  constraint customers_id_org_unique unique (id, organization_id),
  constraint customers_org_phone_unique unique (organization_id, contact_phone)
);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  public_reference text not null,
  status text not null default 'new',
  total_cents integer,
  buyer_name text,
  buyer_phone text,
  note text,
  source text not null default 'catalog',
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_status_check check (status in ('new', 'confirmed', 'completed', 'canceled')),
  constraint orders_total_check check (total_cents is null or total_cents >= 0),
  constraint orders_buyer_name_len check (buyer_name is null or char_length(buyer_name) between 2 and 120),
  constraint orders_buyer_phone_format check (buyer_phone is null or buyer_phone ~ '^[0-9]{10,15}$'),
  constraint orders_note_len check (note is null or char_length(note) <= 500),
  constraint orders_source_check check (source in ('catalog', 'reorder', 'manual')),
  constraint orders_reference_unique unique (public_reference),
  constraint orders_id_org_unique unique (id, organization_id),
  constraint orders_request_unique unique (organization_id, request_id),
  constraint orders_customer_org_fk foreign key (customer_id, organization_id)
    references public.customers(id, organization_id)
    on delete set null (customer_id)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  product_id uuid,
  name_snapshot text not null,
  unit_snapshot text not null,
  unit_price_cents integer,
  quantity integer not null,
  subtotal_cents integer,
  created_at timestamptz not null default now(),
  constraint order_items_quantity_check check (quantity between 1 and 999),
  constraint order_items_price_check check (unit_price_cents is null or unit_price_cents >= 0),
  constraint order_items_subtotal_check check (subtotal_cents is null or subtotal_cents >= 0),
  constraint order_items_order_fk foreign key (order_id, organization_id)
    references public.orders(id, organization_id) on delete cascade,
  constraint order_items_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict
);

create table public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  from_status text,
  to_status text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_status_events_from_check check (from_status is null or from_status in ('new', 'confirmed', 'completed', 'canceled')),
  constraint order_status_events_to_check check (to_status in ('new', 'confirmed', 'completed', 'canceled')),
  constraint order_status_events_order_fk foreign key (order_id, organization_id)
    references public.orders(id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Links de recompra (token_hash nunca é exposto ao cliente)
-- ---------------------------------------------------------------------------
create table public.reorder_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  token_hash text not null,
  template_json jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint reorder_links_token_hash check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint reorder_links_template_array check (jsonb_typeof(template_json) = 'array'),
  constraint reorder_links_expiry check (expires_at > created_at),
  constraint reorder_links_token_unique unique (token_hash),
  constraint reorder_links_customer_fk foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Assinatura (Asaas)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider text not null default 'asaas',
  provider_customer_id text,
  provider_subscription_id text,
  provider_checkout_id text,
  state text not null default 'pending',
  current_period_end timestamptz,
  last_verified_at timestamptz,
  last_provider_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_provider_check check (provider = 'asaas'),
  constraint subscriptions_state_check check (state in ('pending', 'active', 'past_due', 'canceled', 'expired', 'refunded')),
  constraint subscriptions_subscription_unique unique (provider_subscription_id),
  constraint subscriptions_checkout_unique unique (provider_checkout_id)
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null,
  provider text not null default 'asaas',
  event_type text not null,
  payload_minimal jsonb not null default '{}'::jsonb,
  state text not null default 'pending',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  constraint billing_events_provider_check check (provider = 'asaas'),
  constraint billing_events_state_check check (state in ('pending', 'processed', 'failed', 'ignored')),
  constraint billing_events_provider_event_unique unique (provider_event_id),
  constraint billing_events_event_type_len check (char_length(event_type) between 3 and 80)
);

-- ---------------------------------------------------------------------------
-- Auditoria e rate limit
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_action_len check (char_length(action) between 3 and 80),
  constraint audit_events_entity_len check (char_length(entity) between 3 and 80)
);

create table public.rate_limits (
  bucket text primary key,
  window_started_at timestamptz not null,
  counter integer not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
create index products_org_active_idx on public.products (organization_id, active);
create index customers_org_idx on public.customers (organization_id);
create index orders_org_created_idx on public.orders (organization_id, created_at desc);
create index orders_org_status_idx on public.orders (organization_id, status);
create index orders_customer_idx on public.orders (customer_id);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_org_idx on public.order_items (organization_id);
create index order_status_events_order_idx on public.order_status_events (order_id, created_at);
create index reorder_links_org_customer_idx on public.reorder_links (organization_id, customer_id);
create index reorder_links_expiry_idx on public.reorder_links (expires_at);
create index billing_events_state_idx on public.billing_events (state, received_at);
create index audit_events_org_created_idx on public.audit_events (organization_id, created_at desc);
create index rate_limits_updated_idx on public.rate_limits (updated_at);

-- ---------------------------------------------------------------------------
-- Helpers de autorização usados por policies e RPCs.
-- Ficam aqui porque as policies da migration seguinte exigem sua existência.
-- ---------------------------------------------------------------------------
create or replace function app.is_org_owner(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.owner_user_id = auth.uid()
  )
$$;

create or replace function app.org_can_write(p_organization_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_trial timestamptz;
  v_access text;
  v_state text;
  v_period timestamptz;
begin
  select o.trial_ends_at, o.access_state
    into v_trial, v_access
    from public.organizations o
   where o.id = p_organization_id;

  if not found then
    return false;
  end if;

  if v_access = 'blocked' then
    return false;
  end if;

  if now() < v_trial then
    return true;
  end if;

  select s.state, s.current_period_end
    into v_state, v_period
    from public.subscriptions s
   where s.organization_id = p_organization_id;

  if not found then
    return false;
  end if;

  if v_state = 'active' and (v_period is null or v_period > now()) then
    return true;
  end if;

  if v_state = 'past_due' and v_period is not null and now() < v_period + interval '3 days' then
    return true;
  end if;

  if v_state = 'canceled' and v_period is not null and now() < v_period then
    return true;
  end if;

  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers de updated_at
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function app.set_updated_at();

create trigger products_set_updated_at
  before update on public.products
  for each row execute function app.set_updated_at();

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function app.set_updated_at();

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function app.set_updated_at();

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Máquina de estados do pedido + trilha de auditoria
-- ---------------------------------------------------------------------------
create or replace function app.validate_order_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'new' and new.status in ('confirmed', 'canceled')) or
      (old.status = 'confirmed' and new.status in ('completed', 'canceled'))
    ) then
      raise exception 'invalid_status_transition: % -> %', old.status, new.status
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_validate_status
  before update of status on public.orders
  for each row execute function app.validate_order_status_transition();

create or replace function app.log_order_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events (organization_id, order_id, from_status, to_status, actor_user_id)
    values (new.organization_id, new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_status_events (organization_id, order_id, from_status, to_status, actor_user_id)
    values (new.organization_id, new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger orders_log_status_insert
  after insert on public.orders
  for each row execute function app.log_order_status();

create trigger orders_log_status_update
  after update of status on public.orders
  for each row execute function app.log_order_status();
