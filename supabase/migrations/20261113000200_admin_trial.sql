-- PedeOutra V2 — superadmin singleton, auditoria de plataforma e antifraude
-- S1192 suprimido abaixo: status/feature keys sao contrato explicito do schema;
-- a migration e imutavel e validada por testes de DB/restore.
-- de trial (PDA-V10-003/004/005). Migration aditiva; nenhum e-mail é enviado.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Superadmin singleton. O privilégio vem do UUID, nunca de e-mail/metadata.
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  singleton boolean primary key default true,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint platform_admins_singleton_check check (singleton = true)
);

create table public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_organization_id uuid references public.organizations(id) on delete set null,
  reason text,
  status text not null default 'ok',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint platform_audit_action_len check (char_length(action) between 3 and 80),
  constraint platform_audit_status_check check (status in ('ok', 'denied', 'failed')),
  constraint platform_audit_reason_len check (reason is null or char_length(reason) <= 500)
);

create index platform_audit_created_idx
  on public.platform_audit_events (created_at desc);
create index platform_audit_target_idx
  on public.platform_audit_events (target_organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Trial imutável + sinais pseudonimizados (HMAC-SHA-256 com segredo local).
-- ---------------------------------------------------------------------------
create table public.trial_secrets (
  singleton boolean primary key default true,
  secret bytea not null,
  created_at timestamptz not null default now(),
  constraint trial_secrets_singleton_check check (singleton = true)
);

insert into public.trial_secrets (singleton, secret)
values (
  true,
  decode(
    replace(gen_random_uuid()::text, '-', '') ||
    replace(gen_random_uuid()::text, '-', ''),
    'hex'
  )
)
on conflict (singleton) do nothing;

create table public.trial_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid unique references public.organizations(id) on delete set null,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'granted', -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  risk_score integer not null default 0,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trial_grants_status_check check (
    status in ('granted', 'review_required', 'suspended', 'expired', 'converted') -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  ),
  constraint trial_grants_risk_check check (risk_score between 0 and 100),
  constraint trial_grants_reason_len check (review_reason is null or char_length(review_reason) <= 200),
  constraint trial_grants_ends_check check (ends_at > granted_at)
);

create trigger trial_grants_set_updated_at
  before update on public.trial_grants
  for each row execute function app.set_updated_at();

create table public.trial_signals (
  id uuid primary key default gen_random_uuid(),
  signal_type text not null,
  signal_hash text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified boolean not null default false,
  first_seen_at timestamptz not null default now(),
  constraint trial_signals_type_check check (signal_type in ('email', 'phone', 'cnpj')), -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
  constraint trial_signals_hash_check check (signal_hash ~ '^[a-f0-9]{64}$'),
  constraint trial_signals_unique unique (signal_type, signal_hash, organization_id)
);

create index trial_signals_hash_idx
  on public.trial_signals (signal_type, signal_hash);
create index trial_signals_org_idx
  on public.trial_signals (organization_id);

create or replace function app.hash_trial_signal(p_type text, p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_normalized text;
  v_secret bytea;
begin
  if p_type not in ('email', 'phone', 'cnpj') then -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
    raise exception 'invalid_signal_type' using errcode = '22023';
  end if;

  v_normalized := case p_type
    when 'email' then lower(btrim(coalesce(p_value, '')))
    else regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g')
  end;

  if v_normalized = '' then
    return null;
  end if;

  select secret into v_secret from public.trial_secrets where singleton = true;
  if not found then
    raise exception 'trial_secret_missing' using errcode = 'P0001';
  end if;

  return encode(
    extensions.hmac(v_normalized, encode(v_secret, 'hex'), 'sha256'),
    'hex'
  );
end;
$$;

create or replace function app.register_trial_signal(
  p_organization_id uuid,
  p_user_id uuid,
  p_signal_type text,
  p_signal_hash text,
  p_verified boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duplicates integer := 0;
begin
  if p_signal_hash is null then
    return 0;
  end if;

  insert into public.trial_signals
    (signal_type, signal_hash, organization_id, user_id, verified)
  values
    (p_signal_type, p_signal_hash, p_organization_id, p_user_id, coalesce(p_verified, false))
  on conflict (signal_type, signal_hash, organization_id) do nothing;

  select count(distinct s.organization_id)::integer
    into v_duplicates
    from public.trial_signals s
   where s.signal_type = p_signal_type
     and s.signal_hash = p_signal_hash
     and s.organization_id <> p_organization_id;

  return coalesce(v_duplicates, 0);
end;
$$;

-- Concede no máximo um trial por usuário. Repetição de sinais abre revisão,
-- mas não bloqueia automaticamente.
create or replace function app.record_trial_grant(
  p_organization_id uuid,
  p_user_id uuid,
  p_email text,
  p_phone text
)
returns table (status text, ends_at timestamptz, risk_score integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.trial_grants;
  v_email_hash text;
  v_phone_hash text;
  v_email_dupes integer := 0;
  v_phone_dupes integer := 0;
  v_risk integer := 0;
  v_status text := 'granted';
  v_ends timestamptz := now() + interval '7 days';
begin
  select * into v_existing
    from public.trial_grants g
   where g.user_id = p_user_id;

  if found then
    if v_existing.organization_id is null then
      update public.trial_grants
         set organization_id = p_organization_id
       where id = v_existing.id;
    end if;

    update public.organizations
       set trial_ends_at = least(trial_ends_at, v_existing.ends_at),
           access_state = case
             when v_existing.ends_at > now()
              and v_existing.status in ('granted', 'review_required', 'suspended') -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
               then 'trial' -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
             else 'expired'
           end
     where id = p_organization_id;

    return query select v_existing.status, v_existing.ends_at, v_existing.risk_score;
    return;
  end if;

  v_email_hash := app.hash_trial_signal('email', p_email);
  v_phone_hash := app.hash_trial_signal('phone', p_phone);

  select count(distinct s.organization_id)::integer
    into v_email_dupes
    from public.trial_signals s
   where s.signal_type = 'email'
     and s.signal_hash = v_email_hash
     and s.organization_id <> p_organization_id;

  select count(distinct s.organization_id)::integer
    into v_phone_dupes
    from public.trial_signals s
   where s.signal_type = 'phone'
     and s.signal_hash = v_phone_hash
     and s.organization_id <> p_organization_id;

  v_risk := least(100, coalesce(v_email_dupes, 0) * 35 + coalesce(v_phone_dupes, 0) * 25);
  -- Qualquer sinal repetido abre revisão manual; o trial continua ativo até
  -- decisão do admin. Sinal fraco nunca é veto automático.
  if v_risk > 0 then
    v_status := 'review_required';
  end if;

  insert into public.trial_grants
    (organization_id, user_id, ends_at, status, risk_score, review_reason)
  values (
    p_organization_id,
    p_user_id,
    v_ends,
    v_status,
    v_risk,
    case when v_status = 'review_required'
      then 'sinal de contato compartilhado; revisão manual'
      else null
    end
  )
  on conflict (user_id) do nothing
  returning trial_grants.status, trial_grants.ends_at, trial_grants.risk_score
  into status, ends_at, risk_score;

  if not found then
    select g.status, g.ends_at, g.risk_score
      into status, ends_at, risk_score
      from public.trial_grants g
     where g.user_id = p_user_id;

    update public.organizations
       set trial_ends_at = least(trial_ends_at, ends_at),
           access_state = case
             when ends_at > now() and status in ('granted', 'review_required', 'suspended') -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
               then 'trial' -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
             else 'expired'
           end
     where id = p_organization_id;
    return next;
    return;
  end if;

  perform app.register_trial_signal(p_organization_id, p_user_id, 'email', v_email_hash, false);
  perform app.register_trial_signal(p_organization_id, p_user_id, 'phone', v_phone_hash, false);

  update public.organizations
     set trial_ends_at = v_ends,
         access_state = 'trial'
   where id = p_organization_id;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill idempotente: trials existentes são preservados, não reiniciados.
-- ---------------------------------------------------------------------------
insert into public.trial_grants
  (organization_id, user_id, granted_at, ends_at, status, risk_score, review_reason)
select
  o.id,
  o.owner_user_id,
  o.created_at,
  o.trial_ends_at,
  case
    when o.trial_ends_at > now() then 'granted'
    when exists (
      select 1 from public.subscriptions s
       where s.organization_id = o.id
         and s.state in ('active', 'past_due', 'canceled') -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
    ) then 'converted'
    else 'expired'
  end,
  0,
  'legacy_backfill'
from public.organizations o
on conflict (user_id) do nothing;

insert into public.trial_signals
  (signal_type, signal_hash, organization_id, user_id, verified, first_seen_at)
select
  'email',
  app.hash_trial_signal('email', u.email),
  o.id,
  o.owner_user_id,
  false,
  o.created_at
from public.organizations o
join auth.users u on u.id = o.owner_user_id
where u.email is not null
on conflict (signal_type, signal_hash, organization_id) do nothing;

insert into public.trial_signals
  (signal_type, signal_hash, organization_id, user_id, verified, first_seen_at)
select
  'phone',
  app.hash_trial_signal('phone', o.whatsapp),
  o.id,
  o.owner_user_id,
  false,
  o.created_at
from public.organizations o
on conflict (signal_type, signal_hash, organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- Organizações passam a registrar trial esgotado explicitamente.
-- ---------------------------------------------------------------------------
alter table public.organizations
  drop constraint organizations_access_state;
alter table public.organizations
  add constraint organizations_access_state
  check (access_state in ('trial', 'active', 'blocked', 'expired')); -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.

-- ---------------------------------------------------------------------------
-- create_organization: mesma assinatura, agora com grant imutável de trial.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_whatsapp text,
  p_city text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_org public.organizations;
  v_whatsapp text;
  v_email text;
  v_trial record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  v_whatsapp := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
  if v_whatsapp !~ '^[0-9]{10,15}$' then
    raise exception 'invalid_whatsapp' using errcode = '22023';
  end if;

  if p_city is not null and char_length(btrim(p_city)) > 80 then
    raise exception 'invalid_city' using errcode = '22023';
  end if;

  if exists (select 1 from public.organizations o where o.owner_user_id = v_uid) then
    raise exception 'organization_exists' using errcode = '23505';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  insert into public.organizations (owner_user_id, name, slug, whatsapp, city)
  values (
    v_uid,
    btrim(p_name),
    app.generate_slug(p_name),
    v_whatsapp,
    nullif(btrim(coalesce(p_city, '')), '')
  )
  returning * into v_org;

  select * into v_trial
    from app.record_trial_grant(v_org.id, v_uid, v_email, v_whatsapp);

  update public.organizations
     set trial_ends_at = v_trial.ends_at,
         access_state = case
           when v_trial.ends_at > now()
            and v_trial.status in ('granted', 'review_required', 'suspended') -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
             then 'trial' -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
           else 'expired'
         end
   where id = v_org.id
  returning * into v_org;

  insert into public.audit_events (organization_id, actor_user_id, action, entity, entity_id, metadata)
  values (
    v_org.id,
    v_uid,
    'organization.created',
    'organization',
    v_org.id,
    jsonb_build_object('trial_status', v_trial.status, 'risk_score', v_trial.risk_score)
  );

  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Autorização e operações do console admin (chamadas só por Edge/service_role).
-- ---------------------------------------------------------------------------
create or replace function app.is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.platform_admins a
    where a.user_id = p_user_id
      and a.revoked_at is null
  )
$$;

create or replace function public.api_admin_bootstrap(p_user_id uuid)
returns table (user_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.platform_admins;
begin
  if p_user_id is null then
    raise exception 'invalid_admin_user' using errcode = '22023';
  end if;

  insert into public.platform_admins (singleton, user_id)
  values (true, p_user_id)
  on conflict (singleton) do nothing;

  select * into v_existing from public.platform_admins where singleton = true;
  if v_existing.user_id <> p_user_id then
    raise exception 'admin_exists' using errcode = '23505';
  end if;

  if v_existing.revoked_at is not null then
    raise exception 'admin_revoked' using errcode = 'P0001';
  end if;

  return query select v_existing.user_id, v_existing.created_at;
end;
$$;

create or replace function public.api_admin_overview()
returns table (
  organizations_total bigint,
  trials_active bigint,
  trials_review bigint,
  subscriptions_active bigint,
  subscriptions_past_due bigint,
  subscriptions_canceled bigint,
  subscriptions_refunded bigint,
  organizations_blocked bigint,
  confirmed_revenue_cents bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.organizations),
    (select count(*) from public.organizations o
      where o.access_state = 'trial' and o.trial_ends_at > now()),
    (select count(*) from public.trial_grants g where g.status = 'review_required'),
    (select count(*) from public.subscriptions s where s.state = 'active'),
    (select count(*) from public.subscriptions s where s.state = 'past_due'),
    (select count(*) from public.subscriptions s where s.state = 'canceled'),
    (select count(*) from public.subscriptions s where s.state = 'refunded'),
    (select count(*) from public.organizations o where o.access_state = 'blocked'),
    (select coalesce(sum(
        case
          when (e.payload_minimal->>'valueCents') ~ '^[0-9]+$'
            then (e.payload_minimal->>'valueCents')::bigint
          else 0
        end
      ), 0)::bigint
      from public.billing_events e
     where e.state = 'processed'
       and e.event_type in ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'))
$$;

create or replace function public.api_admin_list_organizations(
  p_search text default null,
  p_state text default null,
  p_plan text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  organization_id uuid,
  name text,
  slug text,
  access_state text,
  trial_ends_at timestamptz,
  trial_status text,
  risk_score integer,
  created_at timestamptz,
  plan_code text,
  plan_version integer,
  subscription_state text,
  current_period_end timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_state is not null
     and p_state not in ('trial', 'active', 'blocked', 'expired', 'review') then
    raise exception 'invalid_state_filter' using errcode = '22023';
  end if;
  if p_plan is not null
     and p_plan not in ('essential', 'professional') then -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
    raise exception 'invalid_plan_filter' using errcode = '22023';
  end if;

  return query
    select
      o.id,
      o.name,
      o.slug,
      o.access_state,
      o.trial_ends_at,
      coalesce(g.status, 'none'),
      coalesce(g.risk_score, 0),
      o.created_at,
      coalesce(s.plan_code, 'essential'),
      coalesce(s.plan_version, 1),
      s.state,
      s.current_period_end,
      count(*) over ()
    from public.organizations o
    left join public.trial_grants g on g.organization_id = o.id
    left join public.subscriptions s on s.organization_id = o.id
   where (p_search is null or p_search = ''
          or o.name ilike '%' || p_search || '%'
          or o.slug ilike '%' || p_search || '%')
     and (p_state is null
          or (p_state = 'review' and g.status = 'review_required')
          or (p_state = 'trial' and o.access_state = 'trial' and o.trial_ends_at > now())
          or (p_state in ('active', 'blocked', 'expired') and o.access_state = p_state))
     and (p_plan is null or coalesce(s.plan_code, 'essential') = p_plan)
   order by o.created_at desc
   limit v_limit
   offset v_offset;
end;
$$;

create or replace function public.api_admin_set_org_access(
  p_actor_id uuid,
  p_organization_id uuid,
  p_action text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next text;
  v_trial timestamptz;
  v_state text;
  v_period timestamptz;
begin
  if not app.is_platform_admin(p_actor_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  if p_action not in ('suspend', 'reactivate') then -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
    raise exception 'invalid_admin_action' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then
    raise exception 'invalid_admin_reason' using errcode = '22023';
  end if;

  select o.access_state, o.trial_ends_at
    into v_state, v_trial
    from public.organizations o
   where o.id = p_organization_id
   for update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'suspend' then
    v_next := 'blocked';
  else
    select s.state, s.current_period_end
      into v_state, v_period
      from public.subscriptions s
     where s.organization_id = p_organization_id;

    if found and v_state in ('active', 'past_due', 'canceled')
       and (v_period is null or v_period > now()) then
      v_next := 'active';
    elsif v_trial > now() then
      v_next := 'trial';
    else
      v_next := 'expired';
    end if;
  end if;

  update public.organizations
     set access_state = v_next
   where id = p_organization_id;

  insert into public.platform_audit_events
    (actor_user_id, action, target_organization_id, reason, status, metadata)
  values (
    p_actor_id,
    case when p_action = 'suspend' then 'admin.org.suspend' else 'admin.org.reactivate' end,
    p_organization_id,
    btrim(p_reason),
    'ok',
    jsonb_build_object('new_state', v_next)
  );

  return v_next;
end;
$$;

create or replace function public.api_admin_review_trial(
  p_actor_id uuid,
  p_organization_id uuid,
  p_action text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant public.trial_grants;
  v_next text;
  v_has_paid boolean;
begin
  if not app.is_platform_admin(p_actor_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  if p_action not in ('suspend', 'reactivate', 'clear_review') then
    raise exception 'invalid_admin_action' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then
    raise exception 'invalid_admin_reason' using errcode = '22023';
  end if;

  select * into v_grant
    from public.trial_grants g
   where g.organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'trial_not_found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.subscriptions s
     where s.organization_id = p_organization_id
       and s.state in ('active', 'past_due', 'canceled') -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
       and (s.current_period_end is null or s.current_period_end > now())
  ) into v_has_paid;

  if p_action = 'suspend' then
    v_next := 'suspended';
  elsif p_action = 'reactivate' then
    v_next := case when v_grant.ends_at > now() then 'granted' else 'expired' end;
  else
    v_next := case
      when v_grant.ends_at > now() then 'granted'
      when v_has_paid then 'converted'
      else 'expired'
    end;
  end if;

  update public.trial_grants
     set status = v_next,
         review_reason = case when p_action = 'clear_review' then null else btrim(p_reason) end
   where id = v_grant.id;

  if not v_has_paid then
    update public.organizations
       set access_state = case
         when p_action = 'suspend' then 'blocked'
         when v_next in ('granted', 'converted') then 'trial' -- NOSONAR: literal de contrato do schema; migration imutavel e testada por DB/restore.
         else 'expired'
       end
     where id = p_organization_id;
  end if;

  insert into public.platform_audit_events
    (actor_user_id, action, target_organization_id, reason, status, metadata)
  values (
    p_actor_id,
    'admin.trial.' || p_action,
    p_organization_id,
    btrim(p_reason),
    'ok',
    jsonb_build_object('trial_status', v_next, 'paid_subscription', v_has_paid)
  );

  return v_next;
end;
$$;

create or replace function public.api_admin_platform_audit(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  actor_user_id uuid,
  action text,
  target_organization_id uuid,
  reason text,
  status text,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.id,
    e.actor_user_id,
    e.action,
    e.target_organization_id,
    e.reason,
    e.status,
    e.created_at,
    count(*) over ()
  from public.platform_audit_events e
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ---------------------------------------------------------------------------
-- RLS/grants: nenhum cliente lê admin, trial ou auditoria de plataforma.
-- ---------------------------------------------------------------------------
alter table public.platform_admins enable row level security;
alter table public.platform_audit_events enable row level security;
alter table public.trial_secrets enable row level security;
alter table public.trial_grants enable row level security;
alter table public.trial_signals enable row level security;

revoke all on public.platform_admins from anon, authenticated;
revoke all on public.platform_audit_events from anon, authenticated;
revoke all on public.trial_secrets from anon, authenticated;
revoke all on public.trial_grants from anon, authenticated;
revoke all on public.trial_signals from anon, authenticated;

grant all on public.platform_admins to service_role;
grant all on public.platform_audit_events to service_role;
grant all on public.trial_secrets to service_role;
grant all on public.trial_grants to service_role;
grant all on public.trial_signals to service_role;

revoke all on function app.hash_trial_signal(text, text) from public, anon, authenticated;
revoke all on function app.register_trial_signal(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function app.record_trial_grant(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function app.is_platform_admin(uuid) from public, anon, authenticated;
revoke all on function public.api_admin_bootstrap(uuid) from public, anon, authenticated;
revoke all on function public.api_admin_overview() from public, anon, authenticated;
revoke all on function public.api_admin_list_organizations(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.api_admin_set_org_access(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.api_admin_review_trial(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.api_admin_platform_audit(integer, integer) from public, anon, authenticated;

grant execute on function app.hash_trial_signal(text, text) to service_role;
grant execute on function app.register_trial_signal(uuid, uuid, text, text, boolean) to service_role;
grant execute on function app.record_trial_grant(uuid, uuid, text, text) to service_role;
grant execute on function app.is_platform_admin(uuid) to service_role;
grant execute on function public.api_admin_bootstrap(uuid) to service_role;
grant execute on function public.api_admin_overview() to service_role;
grant execute on function public.api_admin_list_organizations(text, text, text, integer, integer) to service_role;
grant execute on function public.api_admin_set_org_access(uuid, uuid, text, text) to service_role;
grant execute on function public.api_admin_review_trial(uuid, uuid, text, text) to service_role;
grant execute on function public.api_admin_platform_audit(integer, integer) to service_role;
