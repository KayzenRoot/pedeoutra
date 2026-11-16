-- PedeOutra V2 — métricas financeiras administrativas (#79)
-- Fonte: subscriptions/billing_events reconciliados. Pedidos B2B não são receita SaaS.

create or replace function public.api_admin_financial(
  p_actor_id uuid,
  p_days integer default 30
)
returns table (
  metric text,
  value_cents bigint,
  value_count bigint,
  definition text,
  observed boolean,
  last_sync timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
  v_days integer;
  v_sync timestamptz;
  v_essential integer;
  v_professional integer;
  v_received bigint;
  v_refunded bigint;
begin
  if not app.is_platform_admin(p_actor_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  v_days := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since := now() - (v_days || ' days')::interval;

  select max(be.processed_at) into v_sync
    from public.billing_events be where be.state = 'processed'; -- NOSONAR: estado de contrato; migration imutável e coberta por DB/restore.

  select
    count(*) filter (where s.plan_code = 'essential')::integer, -- NOSONAR: plano de contrato; migration imutável e coberta por DB/restore.
    count(*) filter (where s.plan_code = 'professional')::integer -- NOSONAR: plano de contrato; migration imutável e coberta por DB/restore.
    into v_essential, v_professional
    from public.subscriptions s
   where s.state = 'active' -- NOSONAR: estado de contrato; migration imutável e coberta por DB/restore.
     and (s.current_period_end is null or s.current_period_end > now());

  select coalesce(sum(
    case when be.payload_minimal->>'valueCents' ~ '^[0-9]+$' -- NOSONAR: chave de contrato JSON; migration imutável e coberta por DB/restore.
      then (be.payload_minimal->>'valueCents')::bigint else 0 end -- NOSONAR: chave de contrato JSON; migration imutável e coberta por DB/restore.
  ), 0) into v_received
    from public.billing_events be
   where be.state = 'processed'
     and be.event_type in ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED')
     and be.received_at >= v_since;

  select coalesce(sum(
    case when be.payload_minimal->>'valueCents' ~ '^[0-9]+$' -- NOSONAR: chave de contrato JSON; migration imutável e coberta por DB/restore.
      then (be.payload_minimal->>'valueCents')::bigint else 0 end -- NOSONAR: chave de contrato JSON; migration imutável e coberta por DB/restore.
  ), 0) into v_refunded
    from public.billing_events be
   where be.state = 'processed'
     and be.event_type in ('PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED')
     and be.received_at >= v_since;

  return query
  select metrics.metric, metrics.value_cents, metrics.value_count, metrics.definition, metrics.observed, metrics.last_sync
  from (
  select 'mrr_essential'::text as metric,
         (v_essential * coalesce((
           select pc.price_cents from public.plan_catalog pc
            where pc.plan_code = 'essential' and pc.active = true
            order by pc.plan_version desc limit 1
         ), 0))::bigint as value_cents,
         v_essential::bigint as value_count,
         'Assinaturas Essencial ativas e dentro do período, preço vigente.' as definition,
         true as observed, v_sync as last_sync
  union all
  select 'mrr_professional',
         (v_professional * coalesce((
           select pc.price_cents from public.plan_catalog pc
            where pc.plan_code = 'professional' and pc.active = true
            order by pc.plan_version desc limit 1
         ), 0))::bigint,
         v_professional::bigint,
         'Assinaturas Profissional ativas e dentro do período, preço vigente.',
         true, v_sync
  union all
  select 'mrr_total',
         (v_essential * coalesce((
           select pc.price_cents from public.plan_catalog pc
            where pc.plan_code = 'essential' and pc.active = true
            order by pc.plan_version desc limit 1
         ), 0) + v_professional * coalesce((
           select pc.price_cents from public.plan_catalog pc
            where pc.plan_code = 'professional' and pc.active = true
            order by pc.plan_version desc limit 1
         ), 0))::bigint,
         (v_essential + v_professional)::bigint,
         'MRR contratado/projetado; não é recebimento nem lucro.',
         true, v_sync
  union all
  select 'received_cents', v_received, null::bigint,
         'Pagamentos confirmados/recebidos e reconciliados no período.',
         true, v_sync
  union all
  select 'refunded_cents', v_refunded, null::bigint,
         'Reembolsos/estornos confirmados no período.',
         true, v_sync
  union all
  select 'net_after_refunds_cents', v_received - v_refunded, null::bigint,
         'Recebimentos menos reembolsos; tarifas não observadas não são deduzidas.',
         true, v_sync
  union all
  select 'active_subscriptions', null::bigint,
         (v_essential + v_professional)::bigint,
         'Assinaturas ativas válidas (Essencial + Profissional).',
         true, v_sync
  union all
  select 'past_due', null::bigint, count(*)::bigint,
         'Assinaturas em atraso no momento da consulta.',
         true, v_sync
    from public.subscriptions s where s.state = 'past_due'
  union all
  select 'canceled', null::bigint, count(*)::bigint, -- NOSONAR: estado de contrato; migration imutável e coberta por DB/restore.
         'Assinaturas canceladas no momento da consulta.',
         true, v_sync
    from public.subscriptions s where s.state = 'canceled'
  union all
  select 'refunded', null::bigint, count(*)::bigint, -- NOSONAR: estado de contrato; migration imutável e coberta por DB/restore.
         'Assinaturas reembolsadas no momento da consulta.',
         true, v_sync
    from public.subscriptions s where s.state = 'refunded'
  union all
  select 'trials_active', null::bigint, count(*)::bigint,
         'Organizações em trial vigente sem assinatura ativa.',
         true, v_sync
    from public.organizations o
   where o.trial_ends_at > now()
     and not exists (
       select 1 from public.subscriptions s
        where s.organization_id = o.id and s.state = 'active'
     )
  union all
  select 'trials_expired', null::bigint, count(*)::bigint,
         'Organizações com trial vencido e sem assinatura ativa.',
         true, v_sync
    from public.organizations o
   where o.trial_ends_at <= now()
     and not exists (
       select 1 from public.subscriptions s
        where s.organization_id = o.id and s.state = 'active'
     )
  union all
  select 'new_payers', null::bigint, count(*)::bigint,
         'Assinaturas criadas no período (primeiro pagamento observado).',
         true, v_sync
    from public.subscriptions s where s.created_at >= v_since
  union all
  select 'churn_accounts', null::bigint, count(*)::bigint,
         'Assinaturas canceladas/expiradas/reembolsadas atualizadas no período.',
         true, v_sync
    from public.subscriptions s
   where s.state in ('canceled', 'expired', 'refunded')
     and s.updated_at >= v_since
  union all
  select 'cost_meta_ads', null::bigint, null::bigint,
         'Custo Meta Ads indisponível: integração não conectada.',
         false, null::timestamptz
  union all
  select 'cost_deepseek', null::bigint, null::bigint,
         'Custo DeepSeek indisponível: uso não medido.',
         false, null::timestamptz
  union all
  select 'cost_resend', null::bigint, null::bigint,
         'Custo Resend indisponível: SMTP/Resend não conectado.',
         false, null::timestamptz
  ) metrics
  order by metrics.metric asc;
end;
$$;

revoke all on function public.api_admin_financial(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.api_admin_financial(uuid, integer) to service_role;
