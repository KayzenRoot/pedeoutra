-- PedeOutra V2 — webhooks B2B de eventos de pedido (#66)
-- Entrega desligada por padrão; segredo cifrado no servidor.

create table public.api_webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null,
  secret_ciphertext text not null,
  events text[] not null,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_delivery_at timestamptz,
  last_error text,
  constraint api_webhooks_url_len check (char_length(url) between 12 and 500),
  constraint api_webhooks_events_check check (
    events <@ array['order.created', 'order.confirmed', 'order.completed', 'order.canceled']::text[]
    and array_length(events, 1) >= 1
  ),
  constraint api_webhooks_status_check check (status in ('active', 'revoked'))
);

create table public.api_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  webhook_id uuid not null references public.api_webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  response_status integer,
  last_error text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_webhook_deliveries_status_check check (
    status in ('pending', 'delivered', 'failed', 'blocked')
  ),
  constraint api_webhook_deliveries_unique unique (organization_id, idempotency_key)
);

create index api_webhook_deliveries_pending_idx
  on public.api_webhook_deliveries (status, next_attempt_at);

create trigger api_webhook_deliveries_set_updated_at
  before update on public.api_webhook_deliveries
  for each row execute function app.set_updated_at();

create or replace function app.enqueue_api_webhook_event(
  p_order_id uuid,
  p_organization_id uuid,
  p_status text,
  p_reference text,
  p_total_cents integer,
  p_source text,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event text;
  v_webhook record;
  v_payload jsonb;
begin
  v_event := case p_status
    when 'new' then 'order.created'
    when 'confirmed' then 'order.confirmed'
    when 'completed' then 'order.completed'
    when 'canceled' then 'order.canceled'
    else null
  end;
  if v_event is null then
    return;
  end if;

  v_payload := jsonb_build_object(
    'event', v_event,
    'order', jsonb_build_object(
      'id', p_order_id,
      'reference', p_reference,
      'status', p_status,
      'total_cents', p_total_cents,
      'source', p_source,
      'created_at', p_created_at
    )
  );

  for v_webhook in
    select id from public.api_webhooks
     where organization_id = p_organization_id
       and status = 'active'
       and v_event = any(events)
  loop
    insert into public.api_webhook_deliveries (
      organization_id, webhook_id, event, payload, status, idempotency_key, next_attempt_at
    ) values (
      p_organization_id, v_webhook.id, v_event, v_payload, 'pending',
      p_order_id::text || ':' || v_event || ':' || v_webhook.id::text,
      now()
    )
    on conflict (organization_id, idempotency_key) do nothing;
  end loop;
end;
$$;

create or replace function app.api_webhook_order_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  perform app.enqueue_api_webhook_event(
    new.id, new.organization_id, new.status, new.public_reference,
    new.total_cents, new.source, new.created_at
  );
  return new;
end;
$$;

create trigger orders_api_webhook_insert
  after insert on public.orders
  for each row execute function app.api_webhook_order_trigger();

create trigger orders_api_webhook_update
  after update of status on public.orders
  for each row execute function app.api_webhook_order_trigger();

alter table public.api_webhooks enable row level security;
alter table public.api_webhook_deliveries enable row level security;

revoke all on public.api_webhooks from anon, authenticated;
revoke all on public.api_webhook_deliveries from anon, authenticated;
grant all on public.api_webhooks to service_role;
grant all on public.api_webhook_deliveries to service_role;

revoke all on function app.enqueue_api_webhook_event(uuid, uuid, text, text, integer, text, timestamptz)
  from public, anon, authenticated;
revoke all on function app.api_webhook_order_trigger() from public, anon, authenticated;
grant execute on function app.enqueue_api_webhook_event(uuid, uuid, text, text, integer, text, timestamptz)
  to service_role;
grant execute on function app.api_webhook_order_trigger() to service_role;
