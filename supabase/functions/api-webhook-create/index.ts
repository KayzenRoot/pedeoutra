import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import { assertEntitlement } from '../_shared/entitlements.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { encryptSecret, parseEncryptionKey } from '../_shared/whatsapp-crypto.ts'
import { generateReorderToken } from '../_shared/tokens.ts'

const EVENTS = new Set(['order.created', 'order.confirmed', 'order.completed', 'order.canceled'])

function validWebhookUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(local && Deno.env.get('API_WEBHOOK_ALLOW_HTTP') === 'true')) {
      return null
    }
    if (url.username || url.password) return null
    if (url.toString().length > 500) return null
    return url.toString()
  } catch {
    return null
  }
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'api-webhook-create', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])
    await assertEntitlement(supabase, organization.id, 'api_access')
    await enforceRateLimit(supabase, `api-webhook-create:${organization.id}`, 20, 3600)

    const key = parseEncryptionKey(
      Deno.env.get('API_WEBHOOK_ENCRYPTION_KEY') ?? Deno.env.get('WHATSAPP_ENCRYPTION_KEY'),
    )
    if (!key) {
      throw new HttpError(503, 'webhook_encryption_not_configured')
    }

    const body = (await readJson(req)) as Record<string, unknown>
    const url = validWebhookUrl(body.url)
    if (!url) throw new HttpError(400, 'invalid_webhook_url', 'URL HTTPS inválida.')
    const events = Array.isArray(body.events) ? body.events : []
    if (
      events.length < 1 ||
      events.length > EVENTS.size ||
      !events.every((event) => typeof event === 'string' && EVENTS.has(event))
    ) {
      throw new HttpError(400, 'invalid_webhook_events', 'Selecione eventos válidos.')
    }

    const secret = `whsec_${generateReorderToken()}`
    const { data, error } = await supabase
      .from('api_webhooks')
      .insert({
        organization_id: organization.id,
        url,
        secret_ciphertext: await encryptSecret(secret, key),
        events,
        created_by: user.id,
      })
      .select('id, url, events, created_at')
      .single()
    if (error) throw new HttpError(500, 'webhook_create_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'api.webhook_created',
      entity: 'api_webhook',
      entityId: data.id,
      metadata: { events: events.join(',') },
    })

    return jsonResponse(
      req,
      {
        id: data.id,
        url: data.url,
        events: data.events,
        created_at: data.created_at,
        secret,
        warning: 'Guarde o segredo agora; ele não será exibido novamente.',
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
