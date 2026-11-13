-- PedeOutra V2 — catálogo de planos, entitlements e quotas (PDA-PLN-001/002)
-- S1192 suprimido abaixo: status/feature keys sao contrato explicito do schema;
-- a migration e imutavel e validada por testes de DB/restore.
-- Migration aditiva: não altera assinatura, período ou preço de contas legadas.
-- Nenhuma cobrança, e-mail ou chamada ao Asaas acontece aqui.

-- ---------------------------------------------------------------------------
-- Catálogo versionado: única fonte de preço/moeda/limites no servidor.
-- ---------------------------------------------------------------------------
create table public.plan_catalog (
  plan_code text not null,
  plan_version integer not null,
  price_cents integer not null,
  currency text not null default 'BRL',
  trial_days integer not null default 0,
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint plan_catalog_code_check check (plan_code in ('essential', 'professional')), -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  constraint plan_catalog_version_check check (plan_version >= 1),
  constraint plan_catalog_price_check check (price_cents > 0),
  constraint plan_catalog_currency_check check (currency = 'BRL'),
  constraint plan_catalog_trial_check check (trial_days between 0 and 30),
  constraint plan_catalog_pk primary key (plan_code, plan_version)
);

create table public.plan_feature_entitlements (
  plan_code text not null,
  plan_version integer not null,
  feature_key text not null,
  enabled boolean not null default true,
  limit_value bigint,
  limit_window text,
  created_at timestamptz not null default now(),
  constraint plan_feature_key_format check (feature_key ~ '^[a-z][a-z0-9_]{2,60}$'), -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  constraint plan_feature_limit_check check (
    (limit_value is null and limit_window is null)
    or (limit_value is not null and limit_value >= 0 and limit_window is not null)
  ),
  constraint plan_feature_window_check check (
    limit_window is null or limit_window in ('month', 'minute', 'total') -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  ),
  constraint plan_feature_pk primary key (plan_code, plan_version, feature_key),
  constraint plan_feature_plan_fk foreign key (plan_code, plan_version)
    references public.plan_catalog(plan_code, plan_version) on delete cascade
);

insert into public.plan_catalog
  (plan_code, plan_version, price_cents, currency, trial_days, active, effective_from)
values
  ('essential', 1, 2990, 'BRL', 7, true, '2026-11-13T00:00:00Z'),
  ('professional', 1, 6990, 'BRL', 0, true, '2026-11-13T00:00:00Z')
on conflict (plan_code, plan_version) do nothing;

-- enabled=false mantém a matriz explícita e testável para os dois planos.
insert into public.plan_feature_entitlements
  (plan_code, plan_version, feature_key, enabled, limit_value, limit_window)
values
  ('essential', 1, 'catalog_public', true, null, null),
  ('essential', 1, 'products', true, null, null),
  ('essential', 1, 'customers', true, null, null),
  ('essential', 1, 'orders', true, null, null),
  ('essential', 1, 'order_tracking_link', true, null, null),
  ('essential', 1, 'reorder_manual', true, null, null),
  ('essential', 1, 'whatsapp_manual', true, null, null),
  ('essential', 1, 'dashboard_basic', true, null, null),
  ('essential', 1, 'import_csv', true, null, null),
  ('essential', 1, 'pdf_nonfiscal', true, null, null),
  ('essential', 1, 'qr_code', true, null, null),
  ('essential', 1, 'onboarding_templates', true, null, null),
  ('essential', 1, 'sku_quick_order', true, null, null),
  ('essential', 1, 'order_minimum', true, null, null),
  ('essential', 1, 'referrals', true, null, null),
  ('essential', 1, 'private_prices', false, null, null),
  ('essential', 1, 'quotes', false, null, null),
  ('essential', 1, 'reorder_radar', false, null, null),
  ('essential', 1, 'inactive_customers', false, null, null),
  ('essential', 1, 'whatsapp_automation', false, null, null),
  ('essential', 1, 'team', false, null, null),
  ('essential', 1, 'api_access', false, null, null),
  ('essential', 1, 'api_rate', false, null, null),
  ('essential', 1, 'api_keys', false, null, null),
  ('professional', 1, 'catalog_public', true, null, null),
  ('professional', 1, 'products', true, null, null),
  ('professional', 1, 'customers', true, null, null),
  ('professional', 1, 'orders', true, null, null),
  ('professional', 1, 'order_tracking_link', true, null, null),
  ('professional', 1, 'reorder_manual', true, null, null),
  ('professional', 1, 'whatsapp_manual', true, null, null),
  ('professional', 1, 'dashboard_basic', true, null, null),
  ('professional', 1, 'import_csv', true, null, null),
  ('professional', 1, 'pdf_nonfiscal', true, null, null),
  ('professional', 1, 'qr_code', true, null, null),
  ('professional', 1, 'onboarding_templates', true, null, null),
  ('professional', 1, 'sku_quick_order', true, null, null),
  ('professional', 1, 'order_minimum', true, null, null),
  ('professional', 1, 'referrals', true, null, null),
  ('professional', 1, 'private_prices', true, null, null),
  ('professional', 1, 'quotes', true, null, null),
  ('professional', 1, 'reorder_radar', true, null, null),
  ('professional', 1, 'inactive_customers', true, null, null),
  ('professional', 1, 'whatsapp_automation', true, null, null),
  ('professional', 1, 'team', true, 3, 'total'),
  ('professional', 1, 'api_access', true, 10000, 'month'),
  ('professional', 1, 'api_rate', true, 60, 'minute'),
  ('professional', 1, 'api_keys', true, 3, 'total')
on conflict (plan_code, plan_version, feature_key) do nothing;

-- ---------------------------------------------------------------------------
-- Assinatura: plano/versão e intenção de troca. Contas legadas viram
-- essential/1 por default, sem alterar estado, período ou provider.
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column plan_code text not null default 'essential',
  add column plan_version integer not null default 1,
  add column pending_plan_code text,
  add column pending_plan_version integer,
  add column pending_plan_effective_at timestamptz,
  add column pending_provider_checkout_id text;

alter table public.subscriptions
  add constraint subscriptions_plan_fk
    foreign key (plan_code, plan_version)
    references public.plan_catalog(plan_code, plan_version),
  add constraint subscriptions_pending_plan_fk
    foreign key (pending_plan_code, pending_plan_version)
    references public.plan_catalog(plan_code, plan_version),
  add constraint subscriptions_pending_pair_check check (
    (pending_plan_code is null and pending_plan_version is null)
    or (pending_plan_code is not null and pending_plan_version is not null)
  );

create unique index subscriptions_pending_checkout_unique
  on public.subscriptions (pending_provider_checkout_id)
  where pending_provider_checkout_id is not null;

create table public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_plan_code text not null,
  to_plan_code text not null,
  status text not null default 'requested', -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  effective_at timestamptz,
  requested_by uuid references auth.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_changes_from_check check (from_plan_code in ('essential', 'professional')),
  constraint plan_changes_to_check check (to_plan_code in ('essential', 'professional')),
  constraint plan_changes_distinct check (from_plan_code <> to_plan_code),
  constraint plan_changes_status_check check (
    status in ('requested', 'scheduled', 'blocked', 'applied', 'canceled') -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  ),
  constraint plan_changes_reason_len check (reason is null or char_length(reason) <= 500)
);

create unique index plan_changes_one_open_idx
  on public.plan_changes (organization_id)
  where status in ('requested', 'scheduled'); -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
create index plan_changes_org_created_idx
  on public.plan_changes (organization_id, created_at desc);

create trigger plan_changes_set_updated_at
  before update on public.plan_changes
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Quotas atômicas por tenant (API e recursos caros das Partes 2–4).
-- ---------------------------------------------------------------------------
create table public.quota_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quota_key text not null,
  window_start timestamptz not null,
  window_seconds integer not null,
  used bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint quota_usage_key_format check (quota_key ~ '^[a-z][a-z0-9_]{2,60}$'),
  constraint quota_usage_window_check check (window_seconds between 60 and 2678400),
  constraint quota_usage_used_check check (used >= 0),
  constraint quota_usage_pk primary key (organization_id, quota_key, window_start, window_seconds)
);

create index quota_usage_org_updated_idx
  on public.quota_usage (organization_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Plano efetivo no servidor. Ordem: assinatura paga válida > trial Essencial.
-- Não confia em plan_code vindo do cliente nem em claims editáveis.
-- ---------------------------------------------------------------------------
create or replace function app.effective_plan(p_organization_id uuid)
returns table (
  plan_code text,
  plan_version integer,
  access_kind text,
  access_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_access text;
  v_trial timestamptz;
  v_plan_code text;
  v_plan_version integer;
  v_state text;
  v_period timestamptz;
begin
  select o.access_state, o.trial_ends_at
    into v_access, v_trial
    from public.organizations o
   where o.id = p_organization_id;

  if not found or v_access = 'blocked' then
    return;
  end if;

  select s.state, s.current_period_end, s.plan_code, s.plan_version
    into v_state, v_period, v_plan_code, v_plan_version
    from public.subscriptions s
   where s.organization_id = p_organization_id;

  if found then
    if v_state = 'active'
       and (v_period is null or v_period > now()) then
      return query select v_plan_code, v_plan_version, 'active'::text, v_period;
      return;
    end if;
    if v_state = 'past_due'
       and v_period is not null
       and now() < v_period + interval '3 days' then
      return query select v_plan_code, v_plan_version, 'past_due'::text, v_period + interval '3 days';
      return;
    end if;
    if v_state = 'canceled'
       and v_period is not null
       and now() < v_period then
      return query select v_plan_code, v_plan_version, 'canceled'::text, v_period;
      return;
    end if;
  end if;

  -- Trial concede somente o plano Essencial vigente.
  if v_trial is not null and now() < v_trial then
    select pc.plan_code, pc.plan_version
      into v_plan_code, v_plan_version
      from public.plan_catalog pc
     where pc.plan_code = 'essential'
       and pc.active = true
     order by pc.plan_version desc
     limit 1;

    if found then
      return query select v_plan_code, v_plan_version, 'trial'::text, v_trial;
      return;
    end if;
  end if;

  return;
end;
$$;

create or replace function app.has_entitlement(
  p_organization_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from app.effective_plan(p_organization_id) ep
    join public.plan_feature_entitlements e
      on e.plan_code = ep.plan_code
     and e.plan_version = ep.plan_version
    where e.feature_key = p_feature_key
      and e.enabled = true
  )
$$;

-- Consumo atômico; retorna false sem side effect quando a quota acabou.
create or replace function app.consume_quota(
  p_organization_id uuid,
  p_quota_key text,
  p_limit bigint,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_used bigint;
begin
  if p_organization_id is null
     or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'invalid_organization' using errcode = '22023'; -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  end if;
  if p_quota_key is null or p_quota_key !~ '^[a-z][a-z0-9_]{2,60}$' then
    raise exception 'invalid_quota_key' using errcode = '22023';
  end if;
  if p_limit < 1 then
    return false;
  end if;
  if p_window_seconds < 60 or p_window_seconds > 2678400 then
    raise exception 'invalid_quota_window' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.quota_usage
    (organization_id, quota_key, window_start, window_seconds, used, updated_at)
  values
    (p_organization_id, p_quota_key, v_window_start, p_window_seconds, 1, clock_timestamp())
  on conflict (organization_id, quota_key, window_start, window_seconds)
  do update
    set used = public.quota_usage.used + 1,
        updated_at = clock_timestamp()
    where public.quota_usage.used < p_limit
  returning used into v_used;

  return v_used is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wrappers service_role (Edge Functions). Nunca expostos a anon/authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.api_effective_plan(p_organization_id uuid)
returns table (
  plan_code text,
  plan_version integer,
  access_kind text,
  access_until timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.effective_plan(p_organization_id)
$$;

create or replace function public.api_assert_entitlement(
  p_organization_id uuid,
  p_feature_key text
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select app.has_entitlement(p_organization_id, p_feature_key)
$$;

create or replace function public.api_consume_quota(
  p_organization_id uuid,
  p_quota_key text,
  p_limit bigint,
  p_window_seconds integer
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select app.consume_quota(p_organization_id, p_quota_key, p_limit, p_window_seconds)
$$;

-- ---------------------------------------------------------------------------
-- RLS e grants: catálogo e quotas nunca são lidos/escritos direto pelo browser.
-- ---------------------------------------------------------------------------
alter table public.plan_catalog enable row level security;
alter table public.plan_feature_entitlements enable row level security;
alter table public.plan_changes enable row level security;
alter table public.quota_usage enable row level security;

revoke all on public.plan_catalog from anon, authenticated;
revoke all on public.plan_feature_entitlements from anon, authenticated;
revoke all on public.plan_changes from anon, authenticated;
revoke all on public.quota_usage from anon, authenticated;

create policy plan_changes_select_own
  on public.plan_changes for select to authenticated
  using (app.is_org_owner(organization_id));

create policy quota_usage_select_own
  on public.quota_usage for select to authenticated
  using (app.is_org_owner(organization_id));

grant select on public.plan_changes to authenticated;
grant select on public.quota_usage to authenticated;

grant all on public.plan_catalog to service_role;
grant all on public.plan_feature_entitlements to service_role;
grant all on public.plan_changes to service_role;
grant all on public.quota_usage to service_role;

revoke all on function app.effective_plan(uuid) from public, anon, authenticated;
revoke all on function app.has_entitlement(uuid, text) from public, anon, authenticated;
revoke all on function app.consume_quota(uuid, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.api_effective_plan(uuid) from public, anon, authenticated;
revoke all on function public.api_assert_entitlement(uuid, text) from public, anon, authenticated;
revoke all on function public.api_consume_quota(uuid, text, bigint, integer) from public, anon, authenticated;

grant execute on function app.effective_plan(uuid) to service_role;
grant execute on function app.has_entitlement(uuid, text) to service_role;
grant execute on function app.consume_quota(uuid, text, bigint, integer) to service_role;
grant execute on function public.api_effective_plan(uuid) to service_role;
grant execute on function public.api_assert_entitlement(uuid, text) to service_role;
grant execute on function public.api_consume_quota(uuid, text, bigint, integer) to service_role;
