import { adminClient } from '../_shared/supabase.ts'
import { assertWriteAccess, requireSupplier } from '../_shared/auth.ts'
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

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  if (cleaned.length < 3 || cleaned.length > 64) return null
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) return null
  return cleaned
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'whatsapp-connect', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)
    await assertEntitlement(supabase, organization.id, 'whatsapp_automation')
    await enforceRateLimit(supabase, `whatsapp-connect:${organization.id}`, 10, 3600)

    const key = parseEncryptionKey(Deno.env.get('WHATSAPP_ENCRYPTION_KEY'))
    if (!key) {
      throw new HttpError(
        503,
        'whatsapp_encryption_not_configured',
        'A configuração segura do WhatsApp ainda não está habilitada no servidor.',
      )
    }

    const body = (await readJson(req)) as Record<string, unknown>
    const wabaId = cleanId(body.waba_id)
    const phoneNumberId = cleanId(body.phone_number_id)
    const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''
    if (!wabaId || !phoneNumberId) {
      throw new HttpError(400, 'invalid_whatsapp_ids', 'Revise os IDs da WABA e do telefone.')
    }
    if (accessToken.length < 20 || accessToken.length > 4096) {
      throw new HttpError(400, 'invalid_whatsapp_token', 'Token da Meta inválido.')
    }

    const ciphertext = await encryptSecret(accessToken, key)
    const { error } = await supabase.from('whatsapp_connections').upsert(
      {
        organization_id: organization.id,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        token_ciphertext: ciphertext,
        status: 'pending_verification',
        last_error: null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' },
    )
    if (error) throw new HttpError(500, 'whatsapp_connection_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'whatsapp.connection_saved',
      entity: 'whatsapp_connection',
      entityId: organization.id,
      metadata: { waba_id: wabaId, phone_number_id: phoneNumberId, status: 'pending_verification' },
    })

    return jsonResponse(
      req,
      {
        status: 'pending_verification',
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        token_stored: true,
        send_enabled: false,
        message:
          'Credenciais guardadas cifradas. A verificação com a Meta e o envio automático seguem desligados.',
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
