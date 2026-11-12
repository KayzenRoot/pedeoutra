import { adminClient } from '../_shared/supabase.ts'
import { assertWriteAccess, requireSupplier } from '../_shared/auth.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isRecord, isUuid, normalizePhone } from '../_shared/validation.ts'

/**
 * Vincula um pedido público (buyer_name/buyer_phone) a um cliente comercial.
 * O fornecedor escolhe conscientemente; não criamos clientes automaticamente.
 */
export const handler = (req: Request) =>
  withHttpErrors(req, 'link-order-customer', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)

    const body = await readJson(req)
    if (!isRecord(body) || !isUuid(body.order_id)) {
      throw new HttpError(400, 'invalid_order', 'Pedido inválido.')
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, customer_id, buyer_name, buyer_phone')
      .eq('id', body.order_id)
      .eq('organization_id', organization.id)
      .maybeSingle()

    if (orderError) throw new HttpError(500, 'order_lookup_failed')
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido não encontrado.')
    if (order.customer_id) {
      return jsonResponse(req, { customer_id: order.customer_id, created: false })
    }

    const name = typeof order.buyer_name === 'string' ? order.buyer_name.trim() : ''
    const phone = normalizePhone(order.buyer_phone)
    if (!name || !phone) {
      throw new HttpError(
        409,
        'order_without_contact',
        'Este pedido não tem nome e telefone para vincular a um cliente.',
      )
    }

    const { data: existingCustomer, error: customerError } = await supabase
      .from('customers')
      .select('id, display_name')
      .eq('organization_id', organization.id)
      .eq('contact_phone', phone)
      .maybeSingle()

    if (customerError) throw new HttpError(500, 'customer_lookup_failed')

    let customer = existingCustomer
    let created = false

    if (!customer) {
      const { data: inserted, error: insertError } = await supabase
        .from('customers')
        .insert({
          organization_id: organization.id,
          display_name: name,
          contact_phone: phone,
        })
        .select('id, display_name')
        .single()

      if (insertError) {
        // Corrida no unique (org, phone): busca novamente.
        const { data: retried } = await supabase
          .from('customers')
          .select('id, display_name')
          .eq('organization_id', organization.id)
          .eq('contact_phone', phone)
          .maybeSingle()
        if (!retried) throw new HttpError(500, 'customer_create_failed')
        customer = retried
      } else {
        customer = inserted
        created = true
      }
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ customer_id: customer.id })
      .eq('id', order.id)
      .eq('organization_id', organization.id)

    if (updateError) throw new HttpError(500, 'order_link_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'order.customer_linked',
      entity: 'order',
      entityId: order.id,
      metadata: { customer_id: customer.id, created },
    })

    return jsonResponse(req, {
      customer_id: customer.id,
      display_name: customer.display_name,
      created,
    })
  })

if (import.meta.main) Deno.serve(handler)
