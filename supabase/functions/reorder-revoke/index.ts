import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier , assertRole} from '../_shared/auth.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isRecord, isUuid } from '../_shared/validation.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'reorder-revoke', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager', 'operator'])

    const body = await readJson(req)
    if (!isRecord(body) || !isUuid(body.link_id)) {
      throw new HttpError(400, 'invalid_link', 'Link inválido.')
    }

    const { data: link, error } = await supabase
      .from('reorder_links')
      .select('id, revoked_at, customer_id')
      .eq('id', body.link_id)
      .eq('organization_id', organization.id)
      .maybeSingle()

    if (error) throw new HttpError(500, 'link_lookup_failed')
    if (!link) throw new HttpError(404, 'link_not_found', 'Link não encontrado.')

    if (!link.revoked_at) {
      const { error: updateError } = await supabase
        .from('reorder_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', link.id)
        .eq('organization_id', organization.id)

      if (updateError) throw new HttpError(500, 'link_revoke_failed')

      await auditEvent(supabase, {
        organizationId: organization.id,
        actorUserId: user.id,
        action: 'reorder_link.revoked',
        entity: 'reorder_link',
        entityId: link.id,
        metadata: { customer_id: link.customer_id },
      })
    }

    return jsonResponse(req, { revoked: true })
  })

if (import.meta.main) Deno.serve(handler)
