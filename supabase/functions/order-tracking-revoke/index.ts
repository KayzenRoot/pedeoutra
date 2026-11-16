import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier, assertWriteAccess , assertRole} from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
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
  withHttpErrors(req, 'order-tracking-revoke', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager', 'operator'])
    await assertWriteAccess(supabase, organization.id)
    await enforceRateLimit(supabase, `tracking-revoke:${organization.id}`, 30, 3600)

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.order_id)) {
      throw new HttpError(400, 'invalid_order', 'Pedido inválido.')
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('id', body.order_id)
      .eq('organization_id', organization.id)
      .maybeSingle()
    if (orderError) throw new HttpError(503, 'order_lookup_failed')
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido não encontrado.')

    const { data, error } = await supabase
      .from('order_tracking_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('organization_id', organization.id)
      .eq('order_id', body.order_id)
      .is('revoked_at', null)
      .select('id')
    if (error) throw new HttpError(500, 'tracking_revoke_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'order.tracking_link_revoked',
      entity: 'order',
      entityId: body.order_id as string,
      metadata: { revoked: data?.length ?? 0 },
    })

    return jsonResponse(req, { revoked: data?.length ?? 0 })
  })

if (import.meta.main) Deno.serve(handler)
