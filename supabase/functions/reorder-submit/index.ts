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
import { isValidReorderToken, sha256Hex } from '../_shared/tokens.ts'
import { isRecord, parseReorderInput } from '../_shared/validation.ts'
import { throwOrderError } from '../_shared/order-errors.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'reorder-submit', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'reorder-submit'), 60, 60)

    const body = await readJson(req)
    if (!isRecord(body) || !isValidReorderToken(body.token)) {
      throw new HttpError(404, 'link_unavailable', 'Este link não está mais disponível.')
    }

    const parsed = parseReorderInput(body)
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Revise os itens do pedido.')
    }

    const tokenHash = await sha256Hex(body.token)
    const { data: link, error } = await supabase
      .from('reorder_links')
      .select('id, organization_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (error) throw new HttpError(500, 'link_lookup_failed')
    if (!link || link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) {
      throw new HttpError(404, 'link_unavailable', 'Este link não está mais disponível.')
    }

    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', link.organization_id)
      .maybeSingle()

    if (orgError) throw new HttpError(500, 'organization_lookup_failed')
    if (!organization) {
      throw new HttpError(404, 'link_unavailable', 'Este link não está mais disponível.')
    }

    const { data, error: rpcError } = await supabase.rpc('api_submit_reorder', {
      p_org_slug: organization.slug,
      p_items: parsed.value.items,
      p_rate_bucket: await rateBucket(req, 'reorder-rpc'),
      p_link_id: link.id,
      p_request_id: parsed.value.requestId,
    })

    if (rpcError) throwOrderError(rpcError)

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
