-- PedeOutra V2 — programa de indicações (#56)
-- Modo seguro: recompensa fica PENDENTE, sem crédito, cobrança ou alteração no
-- Asaas. Ativação financeira exige aprovação específica e novo ADR.

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null unique,
  status text not null default 'active',
  max_uses integer not null default 25,
  expires_at timestamptz not null default now() + interval '180 days',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint referral_codes_status_check check (status in ('active', 'revoked')),
  constraint referral_codes_code_format check (code ~ '^[a-f0-9]{24}$'),
  constraint referral_codes_max_uses_check check (max_uses between 1 and 500)
);

create unique index referral_codes_one_active_idx
  on public.referral_codes (organization_id)
  where status = 'active';

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_organization_id uuid not null references public.organizations(id) on delete cascade,
  code_id uuid not null references public.referral_codes(id) on delete restrict,
  referred_organization_id uuid not null references public.organizations(id) on delete cascade,
  referred_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'signed_up',
  fraud_flags text[] not null default '{}',
  review_required boolean not null default false,
  qualified_at timestamptz,
  rejected_at timestamptz,
  reversed_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referrals_status_check check (
    status in (
      'invited', 'signed_up', 'trial', 'qualified',
      'reward_pending', 'reward_granted', 'rejected', 'reversed'
    )
  ),
  constraint referrals_no_self_check check (
    referrer_organization_id <> referred_organization_id
  ),
  constraint referrals_referred_unique unique (referred_organization_id),
  constraint referrals_user_unique unique (referred_user_id)
);

create index referrals_referrer_idx
  on public.referrals (referrer_organization_id, created_at desc);
create index referrals_code_idx
  on public.referrals (code_id);

create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null unique references public.referrals(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'referral_credit_pending',
  status text not null default 'pending',
  amount_cents integer,
  note text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_ledger_kind_check check (
    kind in (
      'referral_credit_pending',
      'referral_credit_granted',
      'referral_credit_reversed'
    )
  ),
  constraint reward_ledger_status_check check (
    status in ('pending', 'granted', 'reversed')
  ),
  constraint reward_ledger_amount_check check (
    amount_cents is null or amount_cents >= 0
  )
);

create table public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid references public.referrals(id) on delete cascade,
  code_id uuid references public.referral_codes(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint referral_events_event_check check (
    event in (
      'attributed', 'self_referral', 'code_unavailable', 'limit_reached',
      'same_phone', 'qualified', 'reversed', 'admin_reversed'
    )
  )
);

create index referral_events_created_idx
  on public.referral_events (created_at desc);

create trigger referrals_set_updated_at
  before update on public.referrals
  for each row execute function app.set_updated_at();

create trigger reward_ledger_set_updated_at
  before update on public.reward_ledger
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Código opaco do fornecedor. Apenas owner lê o próprio código; nenhum dado
-- do indicador é exposto ao indicado.
-- ---------------------------------------------------------------------------
create or replace function app.create_referral_code(
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns public.referral_codes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.referral_codes;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.referral_codes (organization_id, code, created_by)
      values (
        p_organization_id,
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
        p_actor_user_id
      )
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke all on function app.create_referral_code(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.create_referral_code(uuid, uuid) to service_role;

create or replace function public.api_referral_code_get_or_create(p_organization_id uuid)
returns table (
  code text,
  link_path text,
  status text,
  max_uses integer,
  uses_count integer,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.referral_codes;
begin
  if app.org_role(p_organization_id) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.has_entitlement(p_organization_id, 'referrals') then
    raise exception 'plan_required' using errcode = '42501';
  end if;

  select rc.* into v_code
    from public.referral_codes rc
   where rc.organization_id = p_organization_id
     and rc.status = 'active'
   limit 1;
  if not found then
    v_code := app.create_referral_code(p_organization_id, auth.uid());
  end if;

  return query
  select
    v_code.code,
    '/criar-conta?ref=' || v_code.code,
    v_code.status,
    v_code.max_uses,
    (select count(*)::integer from public.referrals r
      where r.code_id = v_code.id and r.status <> 'rejected'),
    v_code.expires_at,
    v_code.created_at;
end;
$$;

revoke all on function public.api_referral_code_get_or_create(uuid)
  from public, anon;
grant execute on function public.api_referral_code_get_or_create(uuid)
  to authenticated, service_role;

create or replace function public.api_referral_code_rotate(p_organization_id uuid)
returns table (
  code text,
  link_path text,
  status text,
  max_uses integer,
  uses_count integer,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.referral_codes;
begin
  if app.org_role(p_organization_id) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.has_entitlement(p_organization_id, 'referrals') then
    raise exception 'plan_required' using errcode = '42501';
  end if;

  update public.referral_codes rc
     set status = 'revoked', revoked_at = now()
   where rc.organization_id = p_organization_id
     and rc.status = 'active';

  v_code := app.create_referral_code(p_organization_id, auth.uid());

  return query
  select
    v_code.code,
    '/criar-conta?ref=' || v_code.code,
    v_code.status,
    v_code.max_uses,
    0,
    v_code.expires_at,
    v_code.created_at;
end;
$$;

revoke all on function public.api_referral_code_rotate(uuid)
  from public, anon;
grant execute on function public.api_referral_code_rotate(uuid)
  to authenticated, service_role;

create or replace function public.api_referral_code_revoke(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if app.org_role(p_organization_id) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.referral_codes rc
     set status = 'revoked', revoked_at = now()
   where rc.organization_id = p_organization_id
     and rc.status = 'active';
  return true;
end;
$$;

revoke all on function public.api_referral_code_revoke(uuid)
  from public, anon;
grant execute on function public.api_referral_code_revoke(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Atribuição no cadastro: primeira indicação válida prevalece.
-- ---------------------------------------------------------------------------
create or replace function public.api_referral_attribute(p_code text)
returns table (attributed boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code_text text := lower(btrim(coalesce(p_code, '')));
  v_code public.referral_codes;
  v_org public.organizations;
  v_referrer_phone text;
  v_my_phone text;
  v_same_phone boolean := false;
  v_used integer;
  v_referral public.referrals;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select o.* into v_org
    from public.organizations o
   where o.owner_user_id = v_user_id;
  if not found then
    raise exception 'organization_required' using errcode = 'P0002';
  end if;

  select rc.* into v_code
    from public.referral_codes rc
   where rc.code = v_code_text
   for update;

  if not found then
    insert into public.referral_events (actor_user_id, event)
    values (v_user_id, 'code_unavailable');
    return query select false, 'code_unavailable'::text;
    return;
  end if;

  if v_code.status <> 'active' or v_code.expires_at <= now() then
    insert into public.referral_events (code_id, actor_user_id, event)
    values (v_code.id, v_user_id, 'code_unavailable');
    return query select false, 'code_unavailable'::text;
    return;
  end if;

  if v_code.organization_id = v_org.id then
    insert into public.referral_events (code_id, actor_user_id, event)
    values (v_code.id, v_user_id, 'self_referral');
    return query select false, 'self_referral'::text;
    return;
  end if;

  select count(*)::integer into v_used
    from public.referrals r
   where r.code_id = v_code.id
     and r.status <> 'rejected';
  if v_used >= v_code.max_uses then
    insert into public.referral_events (code_id, actor_user_id, event)
    values (v_code.id, v_user_id, 'limit_reached');
    return query select false, 'code_unavailable'::text;
    return;
  end if;

  select regexp_replace(coalesce(o.whatsapp, ''), '\D', '', 'g') into v_referrer_phone
    from public.organizations o where o.id = v_code.organization_id;
  v_my_phone := regexp_replace(coalesce(v_org.whatsapp, ''), '\D', '', 'g');
  if char_length(v_referrer_phone) >= 10 and char_length(v_my_phone) >= 10 then
    v_same_phone := right(v_referrer_phone, 11) = right(v_my_phone, 11);
  end if;

  insert into public.referrals (
    referrer_organization_id, code_id, referred_organization_id, referred_user_id,
    status, fraud_flags, review_required, rejected_at, idempotency_key
  )
  values (
    v_code.organization_id,
    v_code.id,
    v_org.id,
    v_user_id,
    case when v_same_phone then 'rejected' else 'signed_up' end,
    case when v_same_phone then array['same_phone'] else '{}'::text[] end,
    v_same_phone,
    case when v_same_phone then now() end,
    'signup:' || v_org.id::text
  )
  on conflict (referred_organization_id) do nothing
  returning * into v_referral;

  if not found then
    return query select false, 'already_attributed'::text;
    return;
  end if;

  insert into public.referral_events (referral_id, code_id, actor_user_id, event, metadata)
  values (
    v_referral.id,
    v_code.id,
    v_user_id,
    case when v_same_phone then 'same_phone' else 'attributed' end,
    case when v_same_phone then jsonb_build_object('review', true) else '{}'::jsonb end
  );

  if v_same_phone then
    return query select false, 'review_required'::text;
  end if;
  return query select true, 'attributed'::text;
end;
$$;

revoke all on function public.api_referral_attribute(text)
  from public, anon;
grant execute on function public.api_referral_attribute(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Lista para o fornecedor: status e recompensa, sem identidade do indicado.
-- ---------------------------------------------------------------------------
create or replace function public.api_referral_list(
  p_organization_id uuid,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  referral_id uuid,
  display_label text,
  status text,
  review_required boolean,
  reward_status text,
  reward_amount_cents integer,
  created_at timestamptz,
  qualified_at timestamptz,
  total_count integer
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
  if app.org_role(p_organization_id) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.has_entitlement(p_organization_id, 'referrals') then
    raise exception 'plan_required' using errcode = '42501';
  end if;

  return query
  select
    r.id,
    'Indicação ' || substr(r.id::text, 1, 8),
    r.status,
    r.review_required,
    rl.status,
    rl.amount_cents,
    r.created_at,
    r.qualified_at,
    (count(*) over ())::integer
    from public.referrals r
    left join public.reward_ledger rl on rl.referral_id = r.id
   where r.referrer_organization_id = p_organization_id
   order by r.created_at desc
   limit v_limit offset v_offset;
end;
$$;

revoke all on function public.api_referral_list(uuid, integer, integer)
  from public, anon;
grant execute on function public.api_referral_list(uuid, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Qualificação somente por primeiro pagamento confirmado (service_role).
-- Recompensa nasce pendente, sem crédito nem chamada ao Asaas.
-- ---------------------------------------------------------------------------
create or replace function public.api_referral_qualify(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referral public.referrals;
begin
  select r.* into v_referral
    from public.referrals r
   where r.referred_organization_id = p_organization_id
   for update;
  if not found then
    return false;
  end if;
  if v_referral.review_required
     or v_referral.status in ('rejected', 'reversed', 'reward_granted',
                              'reward_pending', 'qualified') then
    return false;
  end if;

  update public.referrals
     set status = 'qualified', qualified_at = now()
   where id = v_referral.id;

  insert into public.reward_ledger (
    referral_id, organization_id, kind, status, amount_cents, note
  )
  values (
    v_referral.id,
    v_referral.referrer_organization_id,
    'referral_credit_pending',
    'pending',
    null,
    'Aguardando aprovação financeira; nenhum crédito foi aplicado.'
  )
  on conflict (referral_id) do nothing;

  update public.referrals
     set status = 'reward_pending'
   where id = v_referral.id;

  insert into public.referral_events (referral_id, actor_user_id, event, metadata)
  values (
    v_referral.id,
    null,
    'qualified',
    jsonb_build_object('source', 'first_confirmed_payment')
  );
  return true;
end;
$$;

revoke all on function public.api_referral_qualify(uuid)
  from public, anon, authenticated;
grant execute on function public.api_referral_qualify(uuid) to service_role;

create or replace function public.api_referral_reverse(
  p_organization_id uuid,
  p_reason text default 'payment_reversed'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referral public.referrals;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'payment_reversed'), 200);
begin
  select r.* into v_referral
    from public.referrals r
   where r.referred_organization_id = p_organization_id
   for update;
  if not found then
    return false;
  end if;
  if v_referral.status in ('rejected', 'reversed') then
    return false;
  end if;

  update public.referrals
     set status = 'reversed',
         reversed_at = now(),
         review_required = true,
         fraud_flags = array_append(fraud_flags, 'payment_reversed')
   where id = v_referral.id;

  update public.reward_ledger
     set status = 'reversed',
         kind = 'referral_credit_reversed',
         note = left(coalesce(note, '') || ' Reversão: ' || v_reason, 500)
   where referral_id = v_referral.id;

  insert into public.referral_events (referral_id, actor_user_id, event, metadata)
  values (
    v_referral.id,
    null,
    'reversed',
    jsonb_build_object('reason', v_reason)
  );
  return true;
end;
$$;

revoke all on function public.api_referral_reverse(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_referral_reverse(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Administração: leitura e reversão manual auditada.
-- ---------------------------------------------------------------------------
create or replace function public.api_admin_referrals(
  p_actor_id uuid,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  referral_id uuid,
  referrer_name text,
  referred_name text,
  status text,
  review_required boolean,
  fraud_flags text[],
  reward_status text,
  reward_amount_cents integer,
  created_at timestamptz,
  qualified_at timestamptz,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not app.is_platform_admin(p_actor_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in (
    'invited', 'signed_up', 'trial', 'qualified',
    'reward_pending', 'reward_granted', 'rejected', 'reversed'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  return query
  select
    r.id,
    ro.name,
    referred_org.name,
    r.status,
    r.review_required,
    r.fraud_flags,
    rl.status,
    rl.amount_cents,
    r.created_at,
    r.qualified_at,
    (count(*) over ())::integer
    from public.referrals r
    join public.organizations ro on ro.id = r.referrer_organization_id
    join public.organizations referred_org
      on referred_org.id = r.referred_organization_id
    left join public.reward_ledger rl on rl.referral_id = r.id
   where v_status is null or r.status = v_status
   order by r.created_at desc
   limit v_limit offset v_offset;
end;
$$;

revoke all on function public.api_admin_referrals(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.api_admin_referrals(uuid, text, integer, integer)
  to service_role;

create or replace function public.api_admin_referral_reverse(
  p_actor_id uuid,
  p_referral_id uuid,
  p_reason text
)
returns table (referral_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referral public.referrals;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not app.is_platform_admin(p_actor_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select r.* into v_referral
    from public.referrals r
   where r.id = p_referral_id
   for update;
  if not found then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;

  update public.referrals
     set status = 'reversed',
         reversed_at = now(),
         review_required = true,
         fraud_flags = array_append(fraud_flags, 'admin_reversed')
   where id = v_referral.id;

  update public.reward_ledger rl
     set status = 'reversed',
         kind = 'referral_credit_reversed',
         note = left(coalesce(rl.note, '') || ' Reversão admin: ' || v_reason, 500)
   where rl.referral_id = v_referral.id;

  insert into public.referral_events (referral_id, actor_user_id, event, metadata)
  values (
    v_referral.id,
    p_actor_id,
    'admin_reversed',
    jsonb_build_object('reason', v_reason)
  );

  insert into public.platform_audit_events (
    actor_user_id, action, target_organization_id, reason, metadata
  )
  values (
    p_actor_id,
    'referral.reversed',
    v_referral.referrer_organization_id,
    v_reason,
    jsonb_build_object('referral_id', v_referral.id)
  );

  return query select v_referral.id, 'reversed'::text;
end;
$$;

revoke all on function public.api_admin_referral_reverse(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_admin_referral_reverse(uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- RLS: nenhuma tabela é exposta diretamente ao browser; leitura via RPC.
-- ---------------------------------------------------------------------------
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.referral_events enable row level security;

revoke all on public.referral_codes from anon, authenticated;
revoke all on public.referrals from anon, authenticated;
revoke all on public.reward_ledger from anon, authenticated;
revoke all on public.referral_events from anon, authenticated;

grant all on public.referral_codes to service_role;
grant all on public.referrals to service_role;
grant all on public.reward_ledger to service_role;
grant all on public.referral_events to service_role;
