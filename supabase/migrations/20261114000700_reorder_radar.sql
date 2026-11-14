-- PedeOutra V2 — radar de recompra determinístico (#44)
-- Usa apenas pedidos confirmados/concluídos; cancelados e rascunhos não entram.

alter table public.organizations
  add column reorder_min_history integer not null default 3,
  add column reorder_tolerance_days integer not null default 3;

alter table public.organizations
  add constraint organizations_reorder_min_history_check
    check (reorder_min_history between 2 and 10),
  add constraint organizations_reorder_tolerance_check
    check (reorder_tolerance_days between 0 and 30);

alter table public.customers
  add column reorder_snoozed_until timestamptz;

create or replace function public.api_reorder_radar(
  p_organization_id uuid,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  customer_id uuid,
  display_name text,
  contact_phone text,
  valid_order_count integer,
  last_order_at timestamptz,
  median_interval_days numeric,
  next_expected_at timestamptz,
  days_since_last integer,
  overdue boolean,
  insufficient boolean,
  snoozed_until timestamptz,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_min_history integer;
  v_tolerance integer;
  v_search text;
  v_limit integer;
  v_offset integer;
begin
  if not app.is_org_member(p_organization_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.has_entitlement(p_organization_id, 'reorder_radar') then
    raise exception 'plan_required' using errcode = '42501';
  end if;
  select o.reorder_min_history, o.reorder_tolerance_days
    into v_min_history, v_tolerance
    from public.organizations o
   where o.id = p_organization_id;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  v_search := nullif(btrim(coalesce(p_search, '')), '');
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with eligible as (
    select o.customer_id, o.created_at
      from public.orders o
     where o.organization_id = p_organization_id
       and o.customer_id is not null
       and o.status in ('confirmed', 'completed')
  ),
  intervals as (
    select
      e.customer_id,
      extract(epoch from (e.created_at - lag(e.created_at) over (
        partition by e.customer_id order by e.created_at
      ))) / 86400.0 as days
      from eligible e
  ),
  stats as (
    select
      e.customer_id,
      count(*)::integer as valid_order_count,
      max(e.created_at) as last_order_at
      from eligible e
     group by e.customer_id
  ),
  medians as (
    select
      i.customer_id,
      percentile_cont(0.5) within group (order by i.days) as median_days
      from intervals i
     where i.days is not null
     group by i.customer_id
  ),
  computed as (
    select
      c.id as customer_id,
      c.display_name,
      c.contact_phone,
      s.valid_order_count,
      s.last_order_at,
      m.median_days,
      case when s.valid_order_count >= v_min_history
        then round(m.median_days::numeric, 1) end as median_interval_days,
      case when s.valid_order_count >= v_min_history and m.median_days is not null
        then s.last_order_at + (m.median_days || ' days')::interval
      end as next_expected_at,
      ((now() at time zone 'America/Sao_Paulo')::date -
       (s.last_order_at at time zone 'America/Sao_Paulo')::date)::integer as days_since_last, -- NOSONAR: timezone de apresentação; migration imutável e coberta por DB/restore.
      case
        when s.valid_order_count >= v_min_history
         and m.median_days is not null
         and c.reorder_snoozed_until is null
         and ((now() at time zone 'America/Sao_Paulo')::date -
              (s.last_order_at at time zone 'America/Sao_Paulo')::date)
             > ceil(m.median_days)::integer + v_tolerance
        then true else false
      end as overdue,
      s.valid_order_count < v_min_history as insufficient,
      c.reorder_snoozed_until as snoozed_until
      from public.customers c
      join stats s on s.customer_id = c.id
      left join medians m on m.customer_id = c.id
     where c.organization_id = p_organization_id
       and (v_search is null
            or c.display_name ilike '%' || v_search || '%'
            or (regexp_replace(v_search, '\D', '', 'g') <> ''
                and c.contact_phone ilike '%' || regexp_replace(v_search, '\D', '', 'g') || '%'))
  )
  select
    computed.customer_id, computed.display_name, computed.contact_phone,
    computed.valid_order_count, computed.last_order_at,
    computed.median_interval_days, computed.next_expected_at,
    computed.days_since_last, computed.overdue, computed.insufficient,
    computed.snoozed_until,
    count(*) over()::integer as total_count
    from computed
   order by computed.overdue desc, computed.days_since_last desc, computed.display_name asc
   limit v_limit offset v_offset;
end;
$$;

revoke all on function public.api_reorder_radar(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.api_reorder_radar(uuid, text, integer, integer)
  to authenticated, service_role;
