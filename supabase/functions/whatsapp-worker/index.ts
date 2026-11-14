import { adminClient } from '../_shared/supabase.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import { constantTimeEqual } from '../_shared/tokens.ts'
import { decryptSecret, parseEncryptionKey } from '../_shared/whatsapp-crypto.ts'

const MAX_ATTEMPTS = 5
const BATCH_SIZE = 10

function workerAuthorized(req: Request): boolean {
  const expected = Deno.env.get('WHATSAPP_WORKER_TOKEN') ?? ''
  const received = req.headers.get('x-whatsapp-worker-token') ?? ''
  return Boolean(expected) && constantTimeEqual(expected, received)
}

function retryAt(attempts: number): string {
  const minutes = Math.min(60, 2 ** attempts)
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

async function sendTemplate(
  phoneNumberId: string,
  token: string,
  to: string,
  templateName: string,
  language: string,
  reference: string,
): Promise<{ ok: boolean; messageId?: string; status: number; error?: string }> {
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION')?.trim() || 'v21.0'
  const response = await fetch(
    `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: language },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: reference }],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  )
  const payload = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>
    error?: { message?: string }
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: (payload.error?.message ?? `meta_http_${response.status}`).slice(0, 200),
    }
  }
  return { ok: true, status: response.status, messageId: payload.messages?.[0]?.id }
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'whatsapp-worker', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])
    if (!workerAuthorized(req)) {
      throw new HttpError(401, 'unauthorized', 'Worker não autorizado.')
    }
    if (Deno.env.get('WHATSAPP_SEND_ENABLED') !== 'true') {
      return jsonResponse(req, {
        processed: 0,
        disabled: true,
        reason: 'WHATSAPP_SEND_DISABLED',
      })
    }

    const key = parseEncryptionKey(Deno.env.get('WHATSAPP_ENCRYPTION_KEY'))
    if (!key) throw new HttpError(503, 'whatsapp_encryption_not_configured')

    const supabase = adminClient()
    const { data: rows, error } = await supabase
      .from('whatsapp_outbox')
      .select('id, organization_id, recipient_phone, template_id, payload, attempts')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)
    if (error) throw new HttpError(503, 'whatsapp_outbox_lookup_failed')

    let processed = 0
    for (const row of rows ?? []) {
      const { data: connection } = await supabase
        .from('whatsapp_connections')
        .select('phone_number_id, token_ciphertext, status')
        .eq('organization_id', row.organization_id)
        .maybeSingle()
      const { data: template } = row.template_id
        ? await supabase
            .from('whatsapp_templates')
            .select('template_name, language, status')
            .eq('organization_id', row.organization_id)
            .eq('id', row.template_id)
            .maybeSingle()
        : { data: null }

      if (
        !connection ||
        connection.status !== 'connected' ||
        !connection.token_ciphertext ||
        !template ||
        template.status !== 'approved'
      ) {
        await supabase
          .from('whatsapp_outbox')
          .update({ status: 'blocked', blocked_reason: 'connection_or_template_unavailable' })
          .eq('id', row.id)
        continue
      }

      const token = await decryptSecret(connection.token_ciphertext, key)
      const reference =
        typeof row.payload?.reference === 'string' ? row.payload.reference : row.id
      const result = await sendTemplate(
        connection.phone_number_id,
        token,
        row.recipient_phone,
        template.template_name,
        template.language,
        reference,
      )
      const attempts = (row.attempts ?? 0) + 1

      if (result.ok) {
        await supabase
          .from('whatsapp_outbox')
          .update({
            status: 'sent',
            attempts,
            provider_message_id: result.messageId ?? null,
            provider_status: 'sent',
            next_attempt_at: null,
            last_error: null,
          })
          .eq('id', row.id)
        processed += 1
        continue
      }

      const retryable = result.status === 429 || result.status >= 500
      await supabase
        .from('whatsapp_outbox')
        .update({
          status: retryable && attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
          attempts,
          next_attempt_at:
            retryable && attempts < MAX_ATTEMPTS ? retryAt(attempts) : null,
          last_error: result.error ?? 'meta_send_failed',
        })
        .eq('id', row.id)
    }

    return jsonResponse(req, {
      processed,
      disabled: false,
      batch: rows?.length ?? 0,
    })
  })

if (import.meta.main) Deno.serve(handler)
