-- PedeOutra — wrappers públicos chamados apenas pelas Edge Functions.
-- O schema app não é exposto no PostgREST; estes wrappers security definer
-- têm EXECUTE exclusivo de service_role.

create or replace function public.api_submit_order(
  p_org_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_note text,
  p_items jsonb,
  p_rate_bucket text,
  p_request_id uuid
)
returns table (
  order_id uuid,
  public_reference text,
  total_cents integer,
  item_count integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select *
  from app.submit_order(
    p_org_slug, p_buyer_name, p_buyer_phone, p_note, p_items,
    p_rate_bucket, null, 'catalog', p_request_id
  )
$$;

create or replace function public.api_submit_reorder(
  p_org_slug text,
  p_items jsonb,
  p_rate_bucket text,
  p_link_id uuid,
  p_request_id uuid
)
returns table (
  order_id uuid,
  public_reference text,
  total_cents integer,
  item_count integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select *
  from app.submit_order(
    p_org_slug, null, null, null, p_items,
    p_rate_bucket, p_link_id, 'reorder', p_request_id
  )
$$;

create or replace function public.api_consume_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select app.consume_rate_limit(p_bucket, p_limit, p_window_seconds)
$$;

create or replace function public.api_org_can_write(p_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select app.org_can_write(p_organization_id)
$$;

create or replace function public.api_register_billing_event(
  p_provider_event_id text,
  p_event_type text,
  p_payload jsonb
)
returns table (event_id uuid, is_new boolean, state text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.register_billing_event(p_provider_event_id, p_event_type, p_payload)
$$;

create or replace function public.api_mark_billing_event(
  p_event_id uuid,
  p_state text,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  select app.mark_billing_event(p_event_id, p_state, p_error)
$$;

revoke all on function public.api_submit_order(text, text, text, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.api_submit_reorder(text, jsonb, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.api_consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.api_org_can_write(uuid) from public, anon, authenticated;
revoke all on function public.api_register_billing_event(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.api_mark_billing_event(uuid, text, text) from public, anon, authenticated;

grant execute on function public.api_submit_order(text, text, text, text, jsonb, text, uuid) to service_role;
grant execute on function public.api_submit_reorder(text, jsonb, text, uuid, uuid) to service_role;
grant execute on function public.api_consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.api_org_can_write(uuid) to service_role;
grant execute on function public.api_register_billing_event(text, text, jsonb) to service_role;
grant execute on function public.api_mark_billing_event(uuid, text, text) to service_role;
