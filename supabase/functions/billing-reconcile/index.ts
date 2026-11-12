import { adminClient } from '../_shared/supabase.ts'
import { asaasClientFromEnv } from '../_shared/asaas.ts'
import { constantTimeEqual } from '../_shared/tokens.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import {
  processBillingEventById,
  reconcileProviderSubscriptions,
} from '../_shared/billing-processor.ts'

Deno.serve((req) =>
  withHttpErrors(req, 'billing-reconcile', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const expectedToken = Deno.env.get('BILLING_RECONCILE_TOKEN')?.trim()
    if (!expectedToken) {
      throw new HttpError(503, 'reconcile_not_configured', 'Reconciliador não configurado.')
    }

    const providedToken = req.headers.get('x-reconcile-token') ?? ''
    if (!constantTimeEqual(providedToken, expectedToken)) {
      throw new HttpError(401, 'unauthorized', 'Token de reconciliação inválido.')
    }

    const client = asaasClientFromEnv((name) => Deno.env.get(name))
    if (!client) {
      throw new HttpError(
        503,
        'billing_not_configured',
        'Cobrança em produção ainda não configurada (PROD BLOCKED).',
      )
    }

    const supabase = adminClient()
    const { data: events, error: eventsError } = await supabase
      .from('billing_events')
      .select('id, event_type')
      .in('state', ['pending', 'failed'])
      .order('received_at', { ascending: true })
      .limit(20)

    if (eventsError) throw new HttpError(500, 'events_lookup_failed')

    const outcomes = { processed: 0, ignored: 0, failed: 0, skipped: 0 }
    for (const event of events ?? []) {
      try {
        const outcome = await processBillingEventById(supabase, event.id, client)
        outcomes[outcome] += 1
      } catch (error) {
        outcomes.failed += 1
        logError('billing_reconcile_event', error, { event_id: event.id })
      }
    }

    const subscriptions = await reconcileProviderSubscriptions(supabase, client, 20)

    return jsonResponse(req, {
      events_checked: events?.length ?? 0,
      ...outcomes,
      subscriptions,
    })
  }),
)
