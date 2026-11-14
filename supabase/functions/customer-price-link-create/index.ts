import { adminClient } from '../_shared/supabase.ts'
import { assertWriteAccess, requireSupplier } from '../_shared/auth.ts'
import { assertEntitlement } from '../_shared/entitlements.ts'
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
  withHttpErrors(req, 'customer-price-link-create', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)
    await assertEntitlement(supabase, organization.id, 'private_prices')
    await enforceRateLimit(supabase, `price-link-create:${organization.id}`, 30, 3600)

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.customer_id)) {
      throw new HttpError(400, 'invalid_customer', 'Cliente inválido.')
    }

    const [customerResult, assignmentResult] = await Promise.all([
      supabase
        .from('customers')
        .select('id')
        .eq('id', body.customer_id)
        .eq('organization_id', organization.id)
        .maybeSingle(),
      supabase
        .from('customer_price_list_assignments')
        .select('price_list_id')
        .eq('organization_id', organization.id)
        .eq('customer_id', body.customer_id)
        .maybeSingle(),
    ])
    if (customerResult.error || assignmentResult.error) {
      throw new HttpError(503, 'customer_lookup_failed')
    }
    if (!customerResult.data) {
      throw new HttpError(404, 'customer_not_found', 'Cliente não encontrado.')
    }
    if (!assignmentResult.data) {
      throw new HttpError(
        409,
        'price_list_required',
        'Defina uma tabela de preços para este cliente antes de gerar o link.',
      )
    }

    const { data: list, error: listError } = await supabase
      .from('price_lists')
      .select('id, name, active')
      .eq('organization_id', organization.id)
      .eq('id', assignmentResult.data.price_list_id)
      .maybeSingle()
    if (listError) throw new HttpError(503, 'price_list_lookup_failed')
    if (!list || !list.active) {
      throw new HttpError(
        409,
        'price_list_required',
        'A tabela de preços deste cliente está pausada. Ative-a antes de gerar o link.',
      )
    }

    const token = generateReorderToken()
    const tokenHash = await sha256Hex(token)
    const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    await supabase
      .from('customer_price_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('organization_id', organization.id)
      .eq('customer_id', body.customer_id)
      .is('revoked_at', null)

    const { error: insertError } = await supabase.from('customer_price_tokens').insert({
      organization_id: organization.id,
      customer_id: body.customer_id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: user.id,
    })
    if (insertError) throw new HttpError(500, 'price_link_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'customer.price_link_created',
      entity: 'customer',
      entityId: body.customer_id as string,
      metadata: { price_list_id: list.id, expires_at: expiresAt },
    })

    return jsonResponse(
      req,
      {
        url: `${appBaseUrl()}/p/${token}`,
        expires_at: expiresAt,
        price_list: { id: list.id, name: list.name },
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
