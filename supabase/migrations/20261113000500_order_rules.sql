-- PedeOutra V2 — pedido mínimo e múltiplos de embalagem (PDA-VALUE-006 / #49)
-- Migration aditiva: defaults preservam o comportamento anterior (1/1, sem mínimo).

alter table public.organizations
  add column min_order_cents integer,
  add column min_order_items integer;

alter table public.organizations
  add constraint organizations_min_order_cents_check check (
    min_order_cents is null or (min_order_cents >= 0 and min_order_cents <= 100000000)
  ),
  add constraint organizations_min_order_items_check check (
    min_order_items is null or (min_order_items between 1 and 1000)
  );

alter table public.products
  add column min_quantity integer not null default 1,
  add column quantity_increment integer not null default 1;

alter table public.products
  add constraint products_min_quantity_check check (min_quantity between 1 and 999),
  add constraint products_quantity_increment_check check (quantity_increment between 1 and 999),
  add constraint products_quantity_alignment_check check (min_quantity % quantity_increment = 0);

grant update (min_order_cents, min_order_items) on public.organizations to authenticated;

create or replace function app.submit_order(
  p_org_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_note text,
  p_items jsonb,
  p_rate_bucket text,
  p_reorder_link_id uuid default null,
  p_source text default 'catalog',
  p_request_id uuid default null
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
begin
  -- Organização e disponibilidade comercial
  if p_org_slug is null or p_org_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid_organization' using errcode = '22023';
  end if;

  select * into v_org
    from public.organizations o
   where o.slug = p_org_slug;

  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;

  if not app.org_can_write(v_org.id) then
    raise exception 'organization_unavailable' using errcode = 'P0001';
  end if;

  -- Source e link de recompra devem ser coerentes
  if p_source not in ('catalog', 'reorder') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if (p_reorder_link_id is null and p_source <> 'catalog')
     or (p_reorder_link_id is not null and p_source <> 'reorder') then
    raise exception 'invalid_source' using errcode = '22023';
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
  end if;

  -- Idempotência: mesma requisição retorna o mesmo pedido, sem duplicar.
  if p_request_id is not null then
    select o.id, o.public_reference, o.total_cents, o.source, o.customer_id
      into v_order_id, v_reference, v_existing_total, v_existing_source, v_existing_customer
      from public.orders o
     where o.organization_id = v_org.id
       and o.request_id = p_request_id;

    if found then
      if v_existing_source is distinct from p_source
         or (p_reorder_link_id is not null and v_existing_customer is distinct from v_link.customer_id) then
        raise exception 'request_conflict' using errcode = '22023';
      end if;
      select count(*)::integer into v_count
        from public.order_items oi
       where oi.order_id = v_order_id;
      return query select v_order_id, v_reference, v_existing_total, v_count;
      return;
    end if;
  end if;

  -- Rate limit por IP/escopo, por organização e por link.
  if not app.consume_rate_limit(p_rate_bucket, 20, 600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if not app.consume_rate_limit('org:' || v_org.id::text, 120, 3600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if p_reorder_link_id is not null then
    if not app.consume_rate_limit('link:' || p_reorder_link_id::text, 20, 600) then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  -- Validação básica do comprador
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
  if p_reorder_link_id is null and (p_buyer_name is null or p_buyer_phone is null) then
    raise exception 'buyer_required' using errcode = '22023';
  end if;

  -- Itens: array, limites, UUIDs válidos e sem duplicata
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) elem
    where elem is null
       or jsonb_typeof(elem) <> 'object'
       or coalesce(elem->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(elem->>'quantity', '') !~ '^[0-9]{1,3}$'
       or (elem->>'quantity')::integer < 1
       or (elem->>'quantity')::integer > 999
  ) then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct lower(elem->>'product_id')) from jsonb_array_elements(p_items) elem) then
    raise exception 'duplicate_items' using errcode = '22023';
  end if;

  -- Produtos: sempre do tenant, ativos, com preço atual travado durante a transação.
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

    if v_product.price_cents is null then
      v_has_null_price := true;
    else
      v_total := v_total + (v_product.price_cents::bigint * v_item.quantity);
    end if;

    if v_total > 2000000000 then
      raise exception 'order_too_large' using errcode = '22023';
    end if;

    v_snapshots := v_snapshots || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'name', v_product.name,
        'unit', v_product.unit,
        'unit_price_cents', v_product.price_cents,
        'quantity', v_item.quantity,
        'subtotal_cents', case
          when v_product.price_cents is null then null
          else v_product.price_cents::bigint * v_item.quantity
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

  -- Referência pública curta; colisão é tratada com nova tentativa.
  loop
    v_attempt := v_attempt + 1;
    v_reference := 'PD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

    begin
      insert into public.orders (
        organization_id, customer_id, public_reference, status, total_cents,
        buyer_name, buyer_phone, note, source, request_id
      ) values (
        v_org.id,
        case when p_reorder_link_id is not null then v_link.customer_id else null end,
        v_reference,
        'new',
        case when v_has_null_price then null else v_total::integer end,
        case when p_reorder_link_id is null then btrim(p_buyer_name) else null end,
        case when p_reorder_link_id is null then p_buyer_phone else null end,
        nullif(btrim(coalesce(p_note, '')), ''),
        p_source,
        p_request_id
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
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.order_items (
    organization_id, order_id, product_id, name_snapshot, unit_snapshot,
    unit_price_cents, quantity, subtotal_cents
  )
  select
    v_org.id,
    v_order_id,
    (s->>'product_id')::uuid,
    s->>'name',
    s->>'unit',
    case when s->>'unit_price_cents' is null then null else (s->>'unit_price_cents')::integer end,
    (s->>'quantity')::integer,
    case when s->>'subtotal_cents' is null then null else (s->>'subtotal_cents')::integer end
  from jsonb_array_elements(v_snapshots) s;

  if p_reorder_link_id is not null then
    update public.reorder_links
       set last_used_at = now()
     where id = p_reorder_link_id;
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity, entity_id, metadata
  ) values (
    v_org.id, auth.uid(), 'order.created', 'order', v_order_id,
    jsonb_build_object('source', p_source, 'reference', v_reference)
  );

  return query select
    v_order_id,
    v_reference,
    case when v_has_null_price then null else v_total::integer end,
    v_count;
end;
$$;
