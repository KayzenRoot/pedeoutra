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
  withHttpErrors(req, 'api-key-revoke', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.key_id)) {
      throw new HttpError(400, 'invalid_api_key', 'Chave inválida.')
    }

    const { data, error } = await supabase
      .from('api_keys')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', body.key_id)
      .eq('organization_id', organization.id)
      .select('id, status')
      .maybeSingle()
    if (error) throw new HttpError(500, 'api_key_revoke_failed')
    if (!data) throw new HttpError(404, 'api_key_not_found', 'Chave não encontrada.')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'api.key_revoked',
      entity: 'api_key',
      entityId: body.key_id,
    })

    return jsonResponse(req, data)
  })

if (import.meta.main) Deno.serve(handler)
