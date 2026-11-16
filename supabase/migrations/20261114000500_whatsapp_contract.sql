-- PedeOutra V2 — contrato WhatsApp oficial, opt-in e outbox desligado (#29/#30/#31)
-- Nenhum envio real é feito sem credenciais Meta, templates aprovados e flag explícita.

alter table public.orders
  add column whatsapp_opt_in boolean not null default false,
  add column whatsapp_opt_in_at timestamptz,
  add column whatsapp_opt_out_at timestamptz;

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null,
  token_ciphertext text,
  status text not null default 'pending_verification',
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_connections_status_check check (
    status in ('pending_verification', 'connected', 'disabled', 'error')
  ),
  constraint whatsapp_connections_waba_len check (char_length(waba_id) between 3 and 64),
  constraint whatsapp_connections_phone_len check (char_length(phone_number_id) between 3 and 64)
);

create trigger whatsapp_connections_set_updated_at
  before update on public.whatsapp_connections
  for each row execute function app.set_updated_at();

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event text not null,
  template_name text not null,
  language text not null default 'pt_BR',
  status text not null default 'pending', -- NOSONAR: valor de contrato do schema; migration imutável e coberta por DB/restore.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_templates_event_check check (
    event in ('new', 'confirmed', 'completed', 'canceled') -- NOSONAR: enum de contrato do schema; migration imutável e coberta por DB/restore.
  ),
  constraint whatsapp_templates_status_check check (
    status in ('pending', 'approved', 'rejected')
  ),
  constraint whatsapp_templates_name_len check (char_length(template_name) between 1 and 120),
  constraint whatsapp_templates_unique unique (organization_id, event, language)
);

create trigger whatsapp_templates_set_updated_at
  before update on public.whatsapp_templates
  for each row execute function app.set_updated_at();

create table public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  event text not null,
  recipient_phone text not null,
  template_id uuid references public.whatsapp_templates(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'blocked', -- NOSONAR: valor de contrato do schema; migration imutável e coberta por DB/restore.
  blocked_reason text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  provider_message_id text,
  provider_status text,
  last_error text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_outbox_event_check check (
    event in ('new', 'confirmed', 'completed', 'canceled')
  ),
  constraint whatsapp_outbox_status_check check (
    status in ('blocked', 'pending', 'sent', 'failed', 'dead_letter') -- NOSONAR: enum de contrato do schema; migration imutável e coberta por DB/restore.
  ),
  constraint whatsapp_outbox_provider_status_check check (
    provider_status is null or provider_status in ('sent', 'delivered', 'read', 'failed')
  ),
  constraint whatsapp_outbox_unique unique (organization_id, idempotency_key),
  constraint whatsapp_outbox_order_fk foreign key (order_id, organization_id)
    references public.orders(id, organization_id) on delete cascade
);

create table public.whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outbox_id uuid not null references public.whatsapp_outbox(id) on delete cascade,
  provider_status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint whatsapp_events_status_check check (
    provider_status in ('sent', 'delivered', 'read', 'failed')
  ),
  constraint whatsapp_events_unique unique (outbox_id, provider_status)
);

create index whatsapp_events_outbox_idx
  on public.whatsapp_events (outbox_id, created_at asc);

create index whatsapp_outbox_org_status_idx
  on public.whatsapp_outbox (organization_id, status, next_attempt_at);

create trigger whatsapp_outbox_set_updated_at
  before update on public.whatsapp_outbox
  for each row execute function app.set_updated_at();

create or replace function app.enqueue_whatsapp_order_event(
  p_order_id uuid,
  p_organization_id uuid,
  p_event text,
  p_phone text,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_id uuid;
  v_template_id uuid;
  v_status text;
  v_reason text;
begin
  if p_phone is null or p_event not in ('new', 'confirmed', 'completed', 'canceled') then
    return;
  end if;

  select id into v_connection_id
    from public.whatsapp_connections c
   where c.organization_id = p_organization_id
     and c.status = 'connected';

  select id into v_template_id
    from public.whatsapp_templates t
   where t.organization_id = p_organization_id
     and t.event = p_event
     and t.status = 'approved'
   order by t.updated_at desc
   limit 1;

  if v_connection_id is null then
    v_status := 'blocked';
    v_reason := 'connection_not_ready';
  elsif v_template_id is null then
    v_status := 'blocked';
    v_reason := 'template_not_approved';
  else
    v_status := 'pending';
    v_reason := null;
  end if;

  insert into public.whatsapp_outbox (
    organization_id, order_id, event, recipient_phone, template_id,
    payload, status, blocked_reason, idempotency_key, next_attempt_at
  ) values (
    p_organization_id, p_order_id, p_event, p_phone, v_template_id,
    jsonb_build_object('reference', p_reference, 'event', p_event),
    v_status, v_reason, p_order_id::text || ':' || p_event,
    case when v_status = 'pending' then now() else null end
  )
  on conflict (organization_id, idempotency_key) do nothing;
end;
$$;

create or replace function app.whatsapp_enqueue_order_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.whatsapp_opt_in is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  perform app.enqueue_whatsapp_order_event(
    new.id, new.organization_id, new.status, new.buyer_phone, new.public_reference
  );
  return new;
end;
$$;

create trigger orders_whatsapp_enqueue_insert
  after insert on public.orders
  for each row execute function app.whatsapp_enqueue_order_trigger();

create trigger orders_whatsapp_enqueue_update
  after update of status on public.orders
  for each row execute function app.whatsapp_enqueue_order_trigger();

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.whatsapp_outbox enable row level security;
alter table public.whatsapp_events enable row level security;

revoke all on public.whatsapp_connections from anon, authenticated;
revoke all on public.whatsapp_templates from anon, authenticated;
revoke all on public.whatsapp_outbox from anon, authenticated;
revoke all on public.whatsapp_events from anon, authenticated;

create policy whatsapp_connections_select_own
  on public.whatsapp_connections for select to authenticated
  using (app.is_org_owner(organization_id));

create policy whatsapp_templates_select_own
  on public.whatsapp_templates for select to authenticated
  using (app.is_org_owner(organization_id));

create policy whatsapp_outbox_select_own
  on public.whatsapp_outbox for select to authenticated
  using (app.is_org_owner(organization_id));

create policy whatsapp_events_select_own
  on public.whatsapp_events for select to authenticated
  using (app.is_org_owner(organization_id));

grant select on public.whatsapp_connections to authenticated;
grant select on public.whatsapp_templates to authenticated;
grant select on public.whatsapp_outbox to authenticated;
grant select on public.whatsapp_events to authenticated;
grant all on public.whatsapp_connections to service_role;
grant all on public.whatsapp_templates to service_role;
grant all on public.whatsapp_outbox to service_role;
grant all on public.whatsapp_events to service_role;

drop function if exists public.api_submit_order(text, text, text, text, jsonb, text, uuid, text);

create or replace function app.submit_order(
  p_org_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_note text,
  p_items jsonb,
  p_rate_bucket text,
  p_reorder_link_id uuid,
  p_source text,
  p_request_id uuid,
  p_price_token text,
  p_whatsapp_opt_in boolean
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
  v_order record;
  v_org_id uuid;
begin
  select * into v_order
    from app.submit_order(
      p_org_slug, p_buyer_name, p_buyer_phone, p_note, p_items,
      p_rate_bucket, p_reorder_link_id, p_source, p_request_id, p_price_token
    );

  if coalesce(p_whatsapp_opt_in, false) and p_buyer_phone is not null then
    select o.id into v_org_id from public.organizations o where o.slug = p_org_slug;
    update public.orders
       set whatsapp_opt_in = true, whatsapp_opt_in_at = now()
     where id = v_order.order_id
       and organization_id = v_org_id;
    perform app.enqueue_whatsapp_order_event(
      v_order.order_id, v_org_id, 'new', p_buyer_phone, v_order.public_reference
    );
  end if;

  return query select
    v_order.order_id, v_order.public_reference,
    v_order.total_cents, v_order.item_count;
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
  p_price_token text default null,
  p_whatsapp_opt_in boolean default false
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
    p_request_id, p_price_token, p_whatsapp_opt_in
  )
$$;


revoke all on function app.enqueue_whatsapp_order_event(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function app.whatsapp_enqueue_order_trigger() from public, anon, authenticated;
revoke all on function app.submit_order(text, text, text, text, jsonb, text, uuid, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.api_submit_order(text, text, text, text, jsonb, text, uuid, text, boolean) from public, anon, authenticated;

grant execute on function app.enqueue_whatsapp_order_event(uuid, uuid, text, text, text) to service_role;
grant execute on function app.whatsapp_enqueue_order_trigger() to service_role;
grant execute on function app.submit_order(text, text, text, text, jsonb, text, uuid, text, uuid, text, boolean) to service_role;
grant execute on function public.api_submit_order(text, text, text, text, jsonb, text, uuid, text, boolean) to service_role;
