import { adminClient } from '../_shared/supabase.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { parsePublicOrderInput } from '../_shared/validation.ts'
import { throwOrderError } from '../_shared/order-errors.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'public-order', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'order'), 60, 60)

    const parsed = parsePublicOrderInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Revise os dados do pedido.')
    }

    const input = parsed.value
    const { data, error } = await supabase.rpc('api_submit_order', {
      p_org_slug: input.slug,
      p_buyer_name: input.buyerName,
      p_buyer_phone: input.buyerPhone,
      p_note: input.note,
      p_items: input.items,
      p_rate_bucket: await rateBucket(req, 'order-rpc'),
      p_request_id: input.requestId,
      p_price_token: input.priceToken,
    })

    if (error) throwOrderError(error)

    const order = Array.isArray(data) ? data[0] : data
    if (!order) throw new HttpError(500, 'order_failed')

    return jsonResponse(
      req,
      {
        status: 'submitted',
        public_reference: order.public_reference,
        total_cents: order.total_cents,
        item_count: order.item_count,
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
