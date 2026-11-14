import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier, assertWriteAccess , assertRole} from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  appBaseUrl,
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isUuid } from '../_shared/validation.ts'
import { generateReorderToken, sha256Hex } from '../_shared/tokens.ts'

const TTL_DAYS = 30

export const handler = (req: Request) =>
  withHttpErrors(req, 'order-tracking-create', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager', 'operator'])
    await assertWriteAccess(supabase, organization.id)
    await enforceRateLimit(supabase, `tracking-create:${organization.id}`, 30, 3600)

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

    const token = generateReorderToken()
    const tokenHash = await sha256Hex(token)
    const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    await supabase
      .from('order_tracking_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('organization_id', organization.id)
      .eq('order_id', body.order_id)
      .is('revoked_at', null)

    const { error: insertError } = await supabase.from('order_tracking_links').insert({
      organization_id: organization.id,
      order_id: body.order_id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: user.id,
    })
    if (insertError) throw new HttpError(500, 'tracking_link_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'order.tracking_link_created',
      entity: 'order',
      entityId: body.order_id as string,
      metadata: { expires_at: expiresAt },
    })

    return jsonResponse(
      req,
      {
        url: `${appBaseUrl()}/acompanhar/${token}`,
        expires_at: expiresAt,
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
