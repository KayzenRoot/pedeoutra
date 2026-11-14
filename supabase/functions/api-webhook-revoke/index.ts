import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isUuid } from '../_shared/validation.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'api-webhook-revoke', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.webhook_id)) {
      throw new HttpError(400, 'invalid_webhook', 'Webhook inválido.')
    }

    const { data, error } = await supabase
      .from('api_webhooks')
      .update({ status: 'revoked' })
      .eq('id', body.webhook_id)
      .eq('organization_id', organization.id)
      .select('id, status')
      .maybeSingle()
    if (error) throw new HttpError(500, 'webhook_revoke_failed')
    if (!data) throw new HttpError(404, 'webhook_not_found', 'Webhook não encontrado.')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'api.webhook_revoked',
      entity: 'api_webhook',
      entityId: body.webhook_id,
    })

    return jsonResponse(req, data)
  })

if (import.meta.main) Deno.serve(handler)
