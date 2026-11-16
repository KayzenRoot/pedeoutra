-- PedeOutra V2 — relatório de clientes inativos, recorrência e valor (#54)
-- Valores representam pedidos confirmados/concluídos, nunca receita liquidada.
-- Cancelados e rascunhos não entram em nenhuma métrica.

create index if not exists orders_customer_history_idx
  on public.orders (organization_id, customer_id, created_at)
  where customer_id is not null
    and status in ('confirmed', 'completed');

-- Base interna: sem controle de acesso próprio. Só as RPCs públicas, que
-- validam organização/permissão/entitlement, podem expor estes dados.
create or replace function app.customer_insights_base(
  p_organization_id uuid,
  p_inactive_days integer
)
returns table (
  customer_id uuid,
  display_name text,
  contact_phone text,
  valid_order_count integer,
  last_order_at timestamptz,
  days_since_last integer,
  orders_value_cents bigint,
  confirmed_value_cents bigint,
  completed_value_cents bigint,
  median_interval_days numeric,
  frequency_trend text,
  segment text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with valid_orders as (
    select o.customer_id, o.status, o.total_cents, o.created_at
      from public.orders o
     where o.organization_id = p_organization_id
       and o.customer_id is not null
       and o.status in ('confirmed', 'completed')
  ),
  ordered as (
    select
      v.customer_id,
      v.created_at,
      lag(v.created_at) over (
        partition by v.customer_id order by v.created_at
      ) as previous_order_at
      from valid_orders v
  ),
  stats as (
    select
      v.customer_id,
      count(*)::integer as valid_order_count,
      max(v.created_at) as last_order_at,
      coalesce(sum(v.total_cents), 0)::bigint as orders_value_cents,
      coalesce(sum(v.total_cents) filter (where v.status = 'confirmed'), 0)::bigint
        as confirmed_value_cents,
      coalesce(sum(v.total_cents) filter (where v.status = 'completed'), 0)::bigint
        as completed_value_cents
      from valid_orders v
     group by v.customer_id
  ),
  intervals as (
    select
      o.customer_id,
      o.created_at,
      extract(epoch from (o.created_at - o.previous_order_at)) / 86400.0 as days
      from ordered o
     where o.previous_order_at is not null
  ),
  ranked_intervals as (
    select
      i.customer_id,
      i.days,
      row_number() over (
        partition by i.customer_id order by i.created_at desc
      ) as recency_rank
      from intervals i
  ),
  medians as (
    select
      i.customer_id,
      percentile_cont(0.5) within group (order by i.days) as median_days
      from intervals i
     group by i.customer_id
  ),
  trends as (
    select
      r.customer_id,
      percentile_cont(0.5) within group (
        order by case when r.recency_rank <= 3 then r.days end
      ) as recent_days,
      percentile_cont(0.5) within group (
        order by case when r.recency_rank > 3 then r.days end
      ) as prior_days
      from ranked_intervals r
     group by r.customer_id
  ),
  latest_previous as (
    select distinct on (o.customer_id)
      o.customer_id,
      o.previous_order_at
      from ordered o
     order by o.customer_id, o.created_at desc
  ),
  base as (
    select
      c.id as customer_id,
      c.display_name,
      c.contact_phone,
      coalesce(s.valid_order_count, 0)::integer as valid_order_count,
      s.last_order_at,
      case when s.last_order_at is null then null
        else ((now() at time zone 'America/Sao_Paulo')::date -
              (s.last_order_at at time zone 'America/Sao_Paulo')::date)::integer
      end as days_since_last,
      coalesce(s.orders_value_cents, 0)::bigint as orders_value_cents,
      coalesce(s.confirmed_value_cents, 0)::bigint as confirmed_value_cents,
      coalesce(s.completed_value_cents, 0)::bigint as completed_value_cents,
      m.median_days,
      t.recent_days,
      t.prior_days,
      lp.previous_order_at
      from public.customers c
      left join stats s on s.customer_id = c.id
      left join medians m on m.customer_id = c.id
      left join trends t on t.customer_id = c.id
      left join latest_previous lp on lp.customer_id = c.id
     where c.organization_id = p_organization_id
  ),
  enriched as (
    select
      b.customer_id,
      b.display_name,
      b.contact_phone,
      b.valid_order_count,
      b.last_order_at,
      b.days_since_last,
      b.orders_value_cents,
      b.confirmed_value_cents,
      b.completed_value_cents,
      case when b.valid_order_count >= 2 and b.median_days is not null
        then round(b.median_days::numeric, 1) end as median_interval_days,
      case
        when b.valid_order_count >= 2
         and b.recent_days is not null
         and b.prior_days is not null
         and b.prior_days > 0
        then case
          when b.recent_days <= b.prior_days * 0.85 then 'up'
          when b.recent_days >= b.prior_days * 1.15 then 'down'
          else 'stable'
        end
        else 'insufficient'
      end as frequency_trend,
      case
        when b.valid_order_count = 0 then 'no_purchases'
        when b.last_order_at < (
          ((now() at time zone 'America/Sao_Paulo')::date - p_inactive_days)::timestamp
            at time zone 'America/Sao_Paulo'
        ) then 'inactive'
        when b.valid_order_count = 1 then 'insufficient'
        when b.previous_order_at is not null and b.previous_order_at < (
          ((now() at time zone 'America/Sao_Paulo')::date - p_inactive_days)::timestamp
            at time zone 'America/Sao_Paulo'
        ) then 'reactivated'
        when b.median_days is not null
         and b.days_since_last > ceil(b.median_days)::integer + coalesce((
           select o.reorder_tolerance_days
             from public.organizations o
            where o.id = p_organization_id
         ), 3) then 'overdue'
        else 'regular'
      end as segment
      from base b
  )
  select * from enriched
$$;

revoke all on function app.customer_insights_base(uuid, integer)
  from public, anon, authenticated;
grant execute on function app.customer_insights_base(uuid, integer) to service_role;

create or replace function public.api_customer_insights(
  p_organization_id uuid,
  p_inactive_days integer default 30,
  p_segment text default 'all',
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  customer_id uuid,
  display_name text,
  contact_phone text,
  valid_order_count integer,
  last_order_at timestamptz,
  days_since_last integer,
  orders_value_cents bigint,
  confirmed_value_cents bigint,
  completed_value_cents bigint,
  median_interval_days numeric,
  frequency_trend text,
  segment text,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_inactive_days, 30), 1), 365);
  v_segment text := coalesce(nullif(btrim(coalesce(p_segment, '')), ''), 'all');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 2000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_can_contact boolean;
begin
  if not app.has_org_permission(p_organization_id, 'reports.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.has_entitlement(p_organization_id, 'inactive_customers') then
    raise exception 'plan_required' using errcode = '42501';
  end if;
  if v_segment not in (
    'all', 'no_purchases', 'inactive', 'regular', 'overdue', 'reactivated', 'insufficient'
  ) then
    raise exception 'invalid_segment' using errcode = '22023';
  end if;
  v_can_contact := app.has_org_permission(p_organization_id, 'customers.write');
  v_digits := regexp_replace(coalesce(v_search, ''), '\D', '', 'g');

  return query
  with rows as (
    select b.* from app.customer_insights_base(p_organization_id, v_days) b
  ),
  filtered as (
    select r.*
      from rows r
     where (v_segment = 'all' or r.segment = v_segment)
       and (
         v_search is null
         or r.display_name ilike '%' || v_search || '%'
         or (v_can_contact and v_digits <> '' and r.contact_phone like '%' || v_digits || '%')
       )
  )
  select
    f.customer_id,
    f.display_name,
    case when v_can_contact then f.contact_phone else null end,
    f.valid_order_count,
    f.last_order_at,
    f.days_since_last,
    f.orders_value_cents,
    f.confirmed_value_cents,
    f.completed_value_cents,
    f.median_interval_days,
    f.frequency_trend,
    f.segment,
    (count(*) over ())::integer as total_count
    from filtered f
   order by f.days_since_last desc nulls last, f.display_name asc
   limit v_limit offset v_offset;
end;
$$;

revoke all on function public.api_customer_insights(uuid, integer, text, text, integer, integer)
  from public, anon;
grant execute on function public.api_customer_insights(uuid, integer, text, text, integer, integer)
  to authenticated, service_role;

create or replace function public.api_customer_insights_summary(
  p_organization_id uuid,
  p_inactive_days integer default 30
)
returns table (
  total_customers bigint,
  active_customers bigint,
  inactive_customers bigint,
  reactivated_customers bigint,
  no_purchase_customers bigint,
  insufficient_customers bigint,
  valid_order_count bigint,
  orders_value_cents bigint,
  confirmed_value_cents bigint,
  completed_value_cents bigint,
  inactive_days integer,
  window_start timestamptz,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_inactive_days, 30), 1), 365);
  v_window_start timestamptz;
begin
  if not app.has_org_permission(p_organization_id, 'reports.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.has_entitlement(p_organization_id, 'inactive_customers') then
    raise exception 'plan_required' using errcode = '42501';
  end if;
  v_window_start := ((now() at time zone 'America/Sao_Paulo')::date - v_days)::timestamp
    at time zone 'America/Sao_Paulo';

  return query
  with rows as (
    select b.* from app.customer_insights_base(p_organization_id, v_days) b
  )
  select
    count(*)::bigint,
    count(*) filter (
      where r.segment in ('regular', 'overdue', 'reactivated', 'insufficient')
    )::bigint,
    count(*) filter (where r.segment = 'inactive')::bigint,
    count(*) filter (where r.segment = 'reactivated')::bigint,
    count(*) filter (where r.segment = 'no_purchases')::bigint,
    count(*) filter (where r.segment = 'insufficient')::bigint,
    coalesce(sum(r.valid_order_count), 0)::bigint,
    coalesce(sum(r.orders_value_cents), 0)::bigint,
    coalesce(sum(r.confirmed_value_cents), 0)::bigint,
    coalesce(sum(r.completed_value_cents), 0)::bigint,
    v_days,
    v_window_start,
    now()
    from rows r;
end;
$$;

revoke all on function public.api_customer_insights_summary(uuid, integer)
  from public, anon;
grant execute on function public.api_customer_insights_summary(uuid, integer)
  to authenticated, service_role;

create or replace function public.api_customer_order_history(
  p_organization_id uuid,
  p_customer_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  order_id uuid,
  public_reference text,
  status text,
  total_cents integer,
  item_count integer,
  created_at timestamptz,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not app.has_org_permission(p_organization_id, 'reports.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.has_entitlement(p_organization_id, 'inactive_customers') then
    raise exception 'plan_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customers c
     where c.id = p_customer_id and c.organization_id = p_organization_id
  ) then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    o.id,
    o.public_reference,
    o.status,
    o.total_cents,
    (select count(*)::integer from public.order_items oi where oi.order_id = o.id)
      as item_count,
    o.created_at,
    (count(*) over ())::integer as total_count
    from public.orders o
   where o.organization_id = p_organization_id
     and o.customer_id = p_customer_id
   order by o.created_at desc
   limit v_limit offset v_offset;
end;
$$;

revoke all on function public.api_customer_order_history(uuid, uuid, integer, integer)
  from public, anon;
grant execute on function public.api_customer_order_history(uuid, uuid, integer, integer)
  to authenticated, service_role;
