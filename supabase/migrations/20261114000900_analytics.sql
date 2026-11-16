-- PedeOutra V2 — analytics first-party mínimo e consentido (#78)
-- Sem PII, sem IP integral, sem token em path; leitura apenas por admin AAL2.

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event text not null,
  event_version integer not null default 1,
  session_id text not null,
  path text not null,
  source text not null default 'frontend',
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  referrer_class text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  consent_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint analytics_events_source_check check (source in ('frontend', 'server')),
  constraint analytics_events_session_len check (char_length(session_id) between 16 and 80),
  constraint analytics_events_path_len check (char_length(path) between 1 and 200),
  constraint analytics_events_metadata_size check (pg_column_size(metadata) <= 4096)
);

create index analytics_events_occurred_idx
  on public.analytics_events (occurred_at desc, event);
create index analytics_events_session_idx
  on public.analytics_events (session_id, occurred_at desc);

create table public.analytics_consents (
  session_id text primary key,
  analytics boolean not null default false,
  marketing boolean not null default false,
  consent_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_consents_session_len check (char_length(session_id) between 16 and 80),
  constraint analytics_consents_version_len check (char_length(consent_version) between 1 and 40)
);

create trigger analytics_consents_set_updated_at
  before update on public.analytics_consents
  for each row execute function app.set_updated_at();

alter table public.analytics_events enable row level security;
alter table public.analytics_consents enable row level security;

revoke all on public.analytics_events from anon, authenticated;
revoke all on public.analytics_consents from anon, authenticated;
grant all on public.analytics_events to service_role;
grant all on public.analytics_consents to service_role;

create or replace function app.is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_admins pa
     where pa.user_id = p_user_id
       and pa.revoked_at is null
  )
$$;

create or replace function public.api_admin_analytics(
  p_actor_id uuid,
  p_days integer default 30
)
returns table (
  event text,
  sessions integer,
  events integer,
  last_seen timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
  v_days integer;
begin
  if not app.is_platform_admin(p_actor_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  v_days := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since := now() - (v_days || ' days')::interval;

  return query
  with observed as (
    select
      ae.event,
      count(distinct ae.session_id)::integer as sessions,
      count(*)::integer as events,
      max(ae.occurred_at) as last_seen
      from public.analytics_events ae
     where ae.occurred_at >= v_since
     group by ae.event
  ),
  derived as (
    select 'signup_completed'::text as event,
           count(*)::integer as sessions,
           count(*)::integer as events,
           max(u.created_at) as last_seen
      from auth.users u where u.created_at >= v_since
    union all
    select 'trial_started',
           count(distinct tg.user_id)::integer,
           count(*)::integer,
           max(tg.granted_at)
      from public.trial_grants tg where tg.granted_at >= v_since
    union all
    select 'subscription_payment_confirmed',
           count(distinct be.provider_event_id)::integer,
           count(*)::integer,
           max(be.received_at)
      from public.billing_events be
     where be.received_at >= v_since
       and be.event_type in ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED')
    union all
    select 'subscription_refunded',
           count(distinct be.provider_event_id)::integer,
           count(*)::integer,
           max(be.received_at)
      from public.billing_events be
     where be.received_at >= v_since
       and be.event_type in ('PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED')
    union all
    select 'plan_changed',
           count(distinct pc.organization_id)::integer,
           count(*)::integer,
           max(pc.created_at)
      from public.plan_changes pc where pc.created_at >= v_since
  )
  select observed.event, observed.sessions, observed.events, observed.last_seen
    from observed
  union all
  select derived.event, derived.sessions, derived.events, derived.last_seen
    from derived
   where derived.event not in (select o.event from observed o)
   order by event asc;
end;
$$;

create or replace function public.api_admin_analytics_sources(
  p_actor_id uuid,
  p_days integer default 30
)
returns table (
  referrer_class text,
  utm_source text,
  sessions integer,
  events integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
  v_days integer;
begin
  if not app.is_platform_admin(p_actor_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  v_days := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since := now() - (v_days || ' days')::interval;
  return query
    select
      coalesce(ae.referrer_class, 'unknown') as referrer_class,
      ae.utm_source,
      count(distinct ae.session_id)::integer as sessions,
      count(*)::integer as events
      from public.analytics_events ae
     where ae.occurred_at >= v_since
     group by coalesce(ae.referrer_class, 'unknown'), ae.utm_source
     order by sessions desc
     limit 50;
end;
$$;

revoke all on function app.is_platform_admin(uuid) from public, anon, authenticated;
revoke all on function public.api_admin_analytics(uuid, integer) from public, anon, authenticated;
revoke all on function public.api_admin_analytics_sources(uuid, integer) from public, anon, authenticated;
grant execute on function app.is_platform_admin(uuid) to service_role;
grant execute on function public.api_admin_analytics(uuid, integer) to service_role;
grant execute on function public.api_admin_analytics_sources(uuid, integer) to service_role;
