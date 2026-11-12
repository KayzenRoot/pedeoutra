import { adminClient } from '../_shared/supabase.ts'
import { asaasClientFromEnv } from '../_shared/asaas.ts'
import { constantTimeEqual } from '../_shared/tokens.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { runInBackground } from '../_shared/background.ts'
import { parseAsaasEvent } from '../_shared/billing-event.ts'
import { processBillingEventById } from '../_shared/billing-processor.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'asaas-webhook', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const expectedToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN')?.trim()
    if (!expectedToken) {
      throw new HttpError(
        503,
        'billing_not_configured',
        'Webhook de cobrança não configurado (PROD BLOCKED).',
      )
    }

    const providedToken = req.headers.get('asaas-access-token') ?? ''
    if (!constantTimeEqual(providedToken, expectedToken)) {
      throw new HttpError(401, 'unauthorized', 'Token de webhook inválido.')
    }

    const payload = await readJson(req)
    const event = parseAsaasEvent(payload)
    if (!event) throw new HttpError(400, 'invalid_event', 'Evento inválido.')

    const supabase = adminClient()
    const { data, error } = await supabase.rpc('api_register_billing_event', {
      p_provider_event_id: event.id,
      p_event_type: event.type,
      p_payload: event,
    })

    if (error) throw new HttpError(500, 'event_persist_failed')

    const row = Array.isArray(data) ? data[0] : data
    if (!row?.event_id) throw new HttpError(500, 'event_persist_failed')

    if (!row.is_new && (row.state === 'processed' || row.state === 'ignored')) {
      return jsonResponse(req, { received: true, duplicate: true })
    }

    const client = asaasClientFromEnv((name) => Deno.env.get(name))
    await runInBackground(
      'asaas_webhook_process',
      processBillingEventById(supabase, row.event_id, client),
    )

    return jsonResponse(req, { received: true })
  })

if (import.meta.main) Deno.serve(handler)
