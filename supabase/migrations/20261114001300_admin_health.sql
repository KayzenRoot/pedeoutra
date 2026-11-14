-- PedeOutra V2 — saúde operacional administrativa (#80)
-- Somente contagens/estados; nenhum token, PII ou payload privado.

create or replace function public.api_admin_health(p_actor_id uuid)
returns table (
  metric text,
  value_count bigint,
  status text,
  detail text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_platform_admin(p_actor_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return query
  select 'api_keys_active'::text, count(*)::bigint,
         case when count(*) > 0 then 'ok' else 'empty' end,
         'Chaves de API ativas.'
    from public.api_keys k where k.status = 'active'
  union all
  select 'webhooks_active', count(*)::bigint,
         case when count(*) > 0 then 'ok' else 'empty' end,
         'Webhooks B2B ativos.'
    from public.api_webhooks w where w.status = 'active'
  union all
  select 'webhook_deliveries_pending', count(*)::bigint,
         case when count(*) > 100 then 'warning' else 'ok' end,
         'Entregas de webhook pendentes.'
    from public.api_webhook_deliveries d where d.status = 'pending'
  union all
  select 'whatsapp_connections_connected', count(*)::bigint,
         case when count(*) > 0 then 'ok' else 'empty' end,
         'Conexões WhatsApp oficiais conectadas.'
    from public.whatsapp_connections c where c.status = 'connected'
  union all
  select 'whatsapp_outbox_pending', count(*)::bigint,
         case when count(*) > 50 then 'warning' else 'ok' end,
         'Mensagens WhatsApp na fila.'
    from public.whatsapp_outbox o where o.status = 'pending'
  union all
  select 'whatsapp_outbox_failed', count(*)::bigint,
         case when count(*) > 0 then 'warning' else 'ok' end,
         'Mensagens WhatsApp com falha.'
    from public.whatsapp_outbox o where o.status = 'failed'
  union all
  select 'billing_events_failed', count(*)::bigint,
         case when count(*) > 0 then 'warning' else 'ok' end,
         'Eventos de billing com falha.'
    from public.billing_events be where be.state = 'failed'
  union all
  select 'last_billing_sync', 0::bigint, 'info',
         coalesce(to_char(max(be.processed_at) at time zone 'America/Sao_Paulo',
                          'DD/MM/YYYY HH24:MI'), 'nunca')
    from public.billing_events be where be.state = 'processed'
  union all
  select 'last_admin_audit', 0::bigint, 'info',
         coalesce(to_char(max(pa.created_at) at time zone 'America/Sao_Paulo',
                          'DD/MM/YYYY HH24:MI'), 'nunca')
    from public.platform_audit_events pa;
end;
$$;

revoke all on function public.api_admin_health(uuid) from public, anon, authenticated;
grant execute on function public.api_admin_health(uuid) to service_role;
