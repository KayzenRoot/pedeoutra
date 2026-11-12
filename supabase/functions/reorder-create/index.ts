import { adminClient } from '../_shared/supabase.ts'
import { assertWriteAccess, requireSupplier } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  appBaseUrl,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { generateReorderToken, sha256Hex } from '../_shared/tokens.ts'
import { isRecord, isUuid } from '../_shared/validation.ts'

const REORDER_TTL_DAYS = 60
const MAX_ACTIVE_LINKS = 50

export const handler = (req: Request) =>
  withHttpErrors(req, 'reorder-create', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)
    await enforceRateLimit(supabase, `reorder-create:${organization.id}`, 30, 3600)

    const body = await readJson(req)
    if (!isRecord(body) || !isUuid(body.customer_id)) {
      throw new HttpError(400, 'invalid_customer', 'Selecione um cliente válido.')
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, display_name')
      .eq('id', body.customer_id)
      .eq('organization_id', organization.id)
      .maybeSingle()

    if (customerError) throw new HttpError(500, 'customer_lookup_failed')
    if (!customer) throw new HttpError(404, 'customer_not_found', 'Cliente não encontrado.')

    const { count: activeLinks, error: countError } = await supabase
      .from('reorder_links')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organization.id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())

    if (countError) throw new HttpError(500, 'link_count_failed')
    if ((activeLinks ?? 0) >= MAX_ACTIVE_LINKS) {
      throw new HttpError(
        409,
        'link_limit_reached',
        'Há muitos links ativos. Revogue links antigos antes de criar outro.',
      )
    }

    const { data: latestOrder, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('customer_id', customer.id)
      .neq('status', 'canceled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (orderError) throw new HttpError(500, 'order_lookup_failed')
    if (!latestOrder) {
      throw new HttpError(
        409,
        'no_previous_order',
        'Este cliente ainda não tem pedido para repetir.',
      )
    }

    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', latestOrder.id)
      .not('product_id', 'is', null)

    if (itemsError) throw new HttpError(500, 'order_items_lookup_failed')

    const quantities = new Map<string, number>()
    for (const item of orderItems ?? []) {
      if (typeof item.product_id !== 'string') continue
      const quantity =
        typeof item.quantity === 'number' && Number.isInteger(item.quantity) ? item.quantity : 0
      if (quantity < 1) continue
      quantities.set(item.product_id, Math.min(999, (quantities.get(item.product_id) ?? 0) + quantity))
    }

    const productIds = [...quantities.keys()]
    if (productIds.length === 0) {
      throw new HttpError(
        409,
        'no_reorderable_items',
        'O pedido anterior não tem itens disponíveis para recompra.',
      )
    }

    const { data: activeProducts, error: productsError } = await supabase
      .from('products')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('active', true)
      .in('id', productIds)

    if (productsError) throw new HttpError(500, 'catalog_lookup_failed')
    const activeIds = new Set((activeProducts ?? []).map((product) => product.id))
    const template = productIds
      .filter((id) => activeIds.has(id))
      .map((id) => ({ product_id: id, quantity: quantities.get(id) ?? 1 }))

    if (template.length === 0) {
      throw new HttpError(
        409,
        'no_reorderable_items',
        'Os itens do pedido anterior não estão mais ativos.',
      )
    }

    const token = generateReorderToken()
    const tokenHash = await sha256Hex(token)
    const expiresAt = new Date(Date.now() + REORDER_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { data: link, error: insertError } = await supabase
      .from('reorder_links')
      .insert({
        organization_id: organization.id,
        customer_id: customer.id,
        token_hash: tokenHash,
        template_json: template,
        expires_at: expiresAt,
        created_by: user.id,
      })
      .select('id, expires_at')
      .single()

    if (insertError || !link) throw new HttpError(500, 'link_create_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'reorder_link.created',
      entity: 'reorder_link',
      entityId: link.id,
      metadata: { customer_id: customer.id, expires_at: link.expires_at },
    })

    return jsonResponse(
      req,
      {
        link_id: link.id,
        url: `${appBaseUrl()}/r/${token}`,
        expires_at: link.expires_at,
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
