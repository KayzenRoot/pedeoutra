import { adminClient } from '../_shared/supabase.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import { constantTimeEqual } from '../_shared/tokens.ts'
import { toArrayBuffer } from '../_shared/whatsapp-crypto.ts'

interface MetaStatus {
  id?: string
  status?: string
  errors?: Array<{ code?: number; title?: string }>
}

interface MetaWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string }
        statuses?: MetaStatus[]
      }
    }>
  }>
}

async function validSignature(secret: string, body: string, header: string): Promise<boolean> {
  if (!header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, toArrayBuffer(new TextEncoder().encode(body))),
  )
  const expected = Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return constantTimeEqual(expected, header.slice(7).toLowerCase())
}

function statusesFrom(payload: MetaWebhook): Array<MetaStatus & { phoneNumberId: string }> {
  const statuses: Array<MetaStatus & { phoneNumberId: string }> = []
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id
      if (!phoneNumberId) continue
      for (const status of change.value?.statuses ?? []) {
        statuses.push({ ...status, phoneNumberId })
      }
    }
  }
  return statuses
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'whatsapp-webhook', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const secret = Deno.env.get('WHATSAPP_WEBHOOK_SECRET') ?? ''
    if (!secret) throw new HttpError(503, 'whatsapp_webhook_not_configured')

    const body = await req.text()
    const signature = req.headers.get('x-hub-signature-256') ?? ''
    if (!(await validSignature(secret, body, signature))) {
      throw new HttpError(401, 'invalid_signature', 'Assinatura inválida.')
    }

    let payload: MetaWebhook
    try {
      payload = JSON.parse(body) as MetaWebhook
    } catch {
      throw new HttpError(400, 'invalid_json')
    }

    const supabase = adminClient()
    let processed = 0
    for (const status of statusesFrom(payload)) {
      if (!status.id || !status.status) continue
      if (!['sent', 'delivered', 'read', 'failed'].includes(status.status)) continue

      const { data: connection } = await supabase // NOSONAR: webhook processa status em ordem e lote limitado.
        .from('whatsapp_connections')
        .select('organization_id')
        .eq('phone_number_id', status.phoneNumberId)
        .maybeSingle()
      if (!connection) continue

      const { data: outbox } = await supabase // NOSONAR: webhook processa status em ordem e lote limitado.
        .from('whatsapp_outbox')
        .select('id')
        .eq('organization_id', connection.organization_id)
        .eq('provider_message_id', status.id)
        .maybeSingle()
      if (!outbox) continue

      const error = status.errors?.[0]
      await supabase // NOSONAR: webhook processa status em ordem e lote limitado.
        .from('whatsapp_outbox')
        .update({
          provider_status: status.status,
          last_error: error?.title ?? null,
          status: status.status === 'failed' ? 'failed' : 'sent',
        })
        .eq('id', outbox.id)
      await supabase.from('whatsapp_events').upsert( // NOSONAR: webhook processa status em ordem e lote limitado.
        {
          organization_id: connection.organization_id,
          outbox_id: outbox.id,
          provider_status: status.status,
          payload: {
            status: status.status,
            error_code: error?.code ?? null,
          },
        },
        { onConflict: 'outbox_id,provider_status', ignoreDuplicates: true },
      )
      processed += 1
    }

    return jsonResponse(req, { received: true, processed })
  })

if (import.meta.main) Deno.serve(handler)
