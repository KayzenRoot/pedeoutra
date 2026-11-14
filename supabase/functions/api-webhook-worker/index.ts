import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient } from '../_shared/supabase.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import { constantTimeEqual } from '../_shared/tokens.ts'
import { decryptSecret, parseEncryptionKey, toArrayBuffer } from '../_shared/whatsapp-crypto.ts'

const MAX_ATTEMPTS = 5
const BATCH_SIZE = 10

interface DeliveryRow {
  id: string
  organization_id: string
  webhook_id: string
  event: string
  payload: Record<string, unknown>
  attempts: number | null
  idempotency_key: string
}

function authorized(req: Request): boolean {
  const expected = Deno.env.get('API_WEBHOOK_WORKER_TOKEN') ?? ''
  const received = req.headers.get('x-api-webhook-worker-token') ?? ''
  return Boolean(expected) && constantTimeEqual(expected, received)
}

async function signature(secret: string, body: string): Promise<string> {
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
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function processDelivery(
  supabase: SupabaseClient,
  row: DeliveryRow,
  key: Uint8Array,
): Promise<boolean> {
  const { data: webhook } = await supabase
    .from('api_webhooks')
    .select('url, secret_ciphertext, status')
    .eq('id', row.webhook_id)
    .eq('organization_id', row.organization_id)
    .maybeSingle()
  if (!webhook || webhook.status !== 'active') {
    await supabase
      .from('api_webhook_deliveries')
      .update({ status: 'blocked', last_error: 'webhook_revoked' })
      .eq('id', row.id)
    return false
  }

  const secret = await decryptSecret(webhook.secret_ciphertext, key)
  const body = JSON.stringify(row.payload)
  const digest = await signature(secret, body)
  const response = await fetch(webhook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pedeoutra-event': row.event,
      'x-pedeoutra-delivery': row.idempotency_key,
      'x-pedeoutra-signature': `sha256=${digest}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  const attempts = (row.attempts ?? 0) + 1
  const retryable = response.status === 429 || response.status >= 500

  if (response.ok) {
    await supabase
      .from('api_webhook_deliveries')
      .update({
        status: 'delivered',
        attempts,
        response_status: response.status,
        next_attempt_at: null,
        last_error: null,
      })
      .eq('id', row.id)
    await supabase
      .from('api_webhooks')
      .update({ last_delivery_at: new Date().toISOString(), last_error: null })
      .eq('id', row.webhook_id)
    return true
  }

  await supabase
    .from('api_webhook_deliveries')
    .update({
      status: retryable && attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
      attempts,
      response_status: response.status,
      next_attempt_at:
        retryable && attempts < MAX_ATTEMPTS
          ? new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString()
          : null,
      last_error: `http_${response.status}`,
    })
    .eq('id', row.id)
  await supabase
    .from('api_webhooks')
    .update({ last_error: `http_${response.status}` })
    .eq('id', row.webhook_id)
  return false
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'api-webhook-worker', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])
    if (!authorized(req)) throw new HttpError(401, 'unauthorized', 'Worker não autorizado.')
    if (Deno.env.get('API_WEBHOOK_SEND_ENABLED') !== 'true') {
      return jsonResponse(req, {
        processed: 0,
        disabled: true,
        reason: 'API_WEBHOOK_SEND_DISABLED',
      })
    }

    const key = parseEncryptionKey(
      Deno.env.get('API_WEBHOOK_ENCRYPTION_KEY') ?? Deno.env.get('WHATSAPP_ENCRYPTION_KEY'),
    )
    if (!key) throw new HttpError(503, 'webhook_encryption_not_configured')

    const supabase = adminClient()
    const { data: rows, error } = await supabase
      .from('api_webhook_deliveries')
      .select('id, organization_id, webhook_id, event, payload, attempts, idempotency_key')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)
    if (error) throw new HttpError(503, 'webhook_outbox_lookup_failed')

    const results = await Promise.all(
      (rows ?? []).map((row) => processDelivery(supabase, row as DeliveryRow, key)),
    )
    return jsonResponse(req, {
      processed: results.filter(Boolean).length,
      disabled: false,
      batch: rows?.length ?? 0,
    })
  })

if (import.meta.main) Deno.serve(handler)
