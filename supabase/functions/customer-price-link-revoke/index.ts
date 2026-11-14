import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier , assertRole} from '../_shared/auth.ts'
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
  withHttpErrors(req, 'customer-price-link-revoke', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager'])
    await enforceRateLimit(supabase, `price-link-revoke:${organization.id}`, 60, 3600)

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.customer_id)) {
      throw new HttpError(400, 'invalid_customer', 'Cliente inválido.')
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('id', body.customer_id)
      .eq('organization_id', organization.id)
      .maybeSingle()
    if (customerError) throw new HttpError(503, 'customer_lookup_failed')
    if (!customer) {
      throw new HttpError(404, 'customer_not_found', 'Cliente não encontrado.')
    }

    const { data, error } = await supabase
      .from('customer_price_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('organization_id', organization.id)
      .eq('customer_id', body.customer_id)
      .is('revoked_at', null)
      .select('id')
    if (error) throw new HttpError(500, 'price_link_revoke_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'customer.price_link_revoked',
      entity: 'customer',
      entityId: body.customer_id as string,
      metadata: { revoked: data?.length ?? 0 },
    })

    return jsonResponse(req, { revoked: data?.length ?? 0 })
  })

if (import.meta.main) Deno.serve(handler)
