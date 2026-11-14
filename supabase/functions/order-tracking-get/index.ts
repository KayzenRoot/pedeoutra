import { adminClient } from '../_shared/supabase.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  withHttpErrors,
} from '../_shared/http.ts'
import { isValidReorderToken, sha256Hex } from '../_shared/tokens.ts'

const TRACKING_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

function unavailable(req: Request): Response {
  return jsonResponse(
    req,
    { error: 'tracking_unavailable', message: 'Link inválido ou expirado.' },
    404,
    TRACKING_HEADERS,
  )
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'order-tracking-get', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const url = new URL(req.url)
    const token = (url.searchParams.get('token') ?? '').trim()
    if (!isValidReorderToken(token)) return unavailable(req)

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'tracking-get'), 60, 60)

    const tokenHash = await sha256Hex(token)
    const { data: link, error: linkError } = await supabase
      .from('order_tracking_links')
      .select('id, organization_id, order_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (linkError) throw new HttpError(503, 'tracking_lookup_failed')
    if (!link || link.revoked_at) return unavailable(req)
    if (new Date(link.expires_at).getTime() <= Date.now()) return unavailable(req)

    const [orderResult, organizationResult, itemsResult, timelineResult] = await Promise.all([
      supabase
        .from('orders')
        .select('id, public_reference, status, created_at')
        .eq('id', link.order_id)
        .eq('organization_id', link.organization_id)
        .maybeSingle(),
      supabase
        .from('organizations')
        .select('name, slug')
        .eq('id', link.organization_id)
        .maybeSingle(),
      supabase
        .from('order_items')
        .select('name_snapshot, quantity')
        .eq('order_id', link.order_id)
        .eq('organization_id', link.organization_id)
        .order('created_at', { ascending: true }),
      supabase
        .from('order_status_events')
        .select('to_status, created_at')
        .eq('order_id', link.order_id)
        .eq('organization_id', link.organization_id)
        .order('created_at', { ascending: true }),
    ])

    if (
      orderResult.error ||
      organizationResult.error ||
      itemsResult.error ||
      timelineResult.error
    ) {
      throw new HttpError(503, 'tracking_lookup_failed')
    }
    if (!orderResult.data || !organizationResult.data) return unavailable(req)

    return jsonResponse(
      req,
      {
        supplier: {
          name: organizationResult.data.name,
          slug: organizationResult.data.slug,
        },
        reference: orderResult.data.public_reference,
        status: orderResult.data.status,
        created_at: orderResult.data.created_at,
        items: (itemsResult.data ?? []).map((item) => ({
          name: item.name_snapshot,
          quantity: item.quantity,
        })),
        timeline: (timelineResult.data ?? []).map((event) => ({
          status: event.to_status,
          at: event.created_at,
        })),
        expires_at: link.expires_at,
      },
      200,
      TRACKING_HEADERS,
    )
  })

if (import.meta.main) Deno.serve(handler)
