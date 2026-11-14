import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'whatsapp-disconnect', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await enforceRateLimit(supabase, `whatsapp-disconnect:${organization.id}`, 20, 3600)

    const { error } = await supabase
      .from('whatsapp_connections')
      .update({
        status: 'disabled',
        token_ciphertext: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', organization.id)
    if (error) throw new HttpError(500, 'whatsapp_disconnect_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'whatsapp.disconnected',
      entity: 'whatsapp_connection',
      entityId: organization.id,
    })

    return jsonResponse(req, { status: 'disabled', send_enabled: false })
  })

if (import.meta.main) Deno.serve(handler)
