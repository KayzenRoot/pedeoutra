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
drop function if exists app.submit_order(text, text, text, text, jsonb, text, uuid, text, uuid, text);

create or replace function app.submit_order(
  p_org_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_note text,
  p_items jsonb,
  p_rate_bucket text,
  p_reorder_link_id uuid default null,
  p_source text default 'catalog', -- NOSONAR: valor de contrato do schema; migration imutável e coberta por DB/restore.
  p_request_id uuid default null,
  p_price_token text default null,
  p_whatsapp_opt_in boolean default false
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
  v_whatsapp_opt_in boolean;
begin
  if p_org_slug is null or p_org_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid_organization' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  select * into v_org from public.organizations o where o.slug = p_org_slug;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if not app.org_can_write(v_org.id) then
    raise exception 'organization_unavailable' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  if p_source not in ('catalog', 'reorder', 'private') then -- NOSONAR: enum de contrato do schema; migration imutável e coberta por DB/restore.
    raise exception 'invalid_source' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if (p_price_token is not null and p_source <> 'private')
     or (p_price_token is null and p_source = 'private') then
    raise exception 'invalid_source' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if (p_reorder_link_id is null and p_source = 'reorder')
     or (p_reorder_link_id is not null and p_source <> 'reorder') then
    raise exception 'invalid_source' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if p_reorder_link_id is not null and p_price_token is not null then
    raise exception 'invalid_source' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
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
      raise exception 'rate_limited' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
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
      raise exception 'rate_limited' using errcode = 'P0001'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
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
  v_whatsapp_opt_in := coalesce(p_whatsapp_opt_in, false) and p_buyer_phone is not null;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where elem is null
       or jsonb_typeof(elem) <> 'object'
       or coalesce(elem->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -- NOSONAR: regex de contrato do schema; migration imutável e coberta por DB/restore.
       or coalesce(elem->>'quantity', '') !~ '^[0-9]{1,3}$' -- NOSONAR: regex de contrato do schema; migration imutável e coberta por DB/restore.
       or (elem->>'quantity')::integer < 1
       or (elem->>'quantity')::integer > 999
  ) then
    raise exception 'invalid_items' using errcode = '22023'; -- NOSONAR: código de contrato do schema; migration imutável e coberta por DB/restore.
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
        'unit_price_cents', v_unit_price, -- NOSONAR: chave de contrato do snapshot; migration imutável e coberta por DB/restore.
        'quantity', v_item.quantity,
        'subtotal_cents', case -- NOSONAR: chave de contrato do snapshot; migration imutável e coberta por DB/restore.
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
        buyer_name, buyer_phone, note, source, request_id, price_list_id, price_source,
        whatsapp_opt_in, whatsapp_opt_in_at
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
        case when p_price_token is not null then 'private' else 'public' end,
        v_whatsapp_opt_in,
        case when v_whatsapp_opt_in then now() else null end
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
