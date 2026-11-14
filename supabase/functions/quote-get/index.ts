import { adminClient } from '../_shared/supabase.ts'
import { findPublicOrganizationById } from '../_shared/org.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  withHttpErrors,
} from '../_shared/http.ts'
import { isValidReorderToken, sha256Hex } from '../_shared/tokens.ts'

const QUOTE_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

function unavailable(req: Request): Response {
  return jsonResponse(
    req,
    { error: 'quote_link_unavailable', message: 'Este orçamento não está mais disponível.' },
    404,
    QUOTE_HEADERS,
  )
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'quote-get', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const url = new URL(req.url)
    const token = (url.searchParams.get('token') ?? '').trim()
    if (!isValidReorderToken(token)) return unavailable(req)

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'quote-get'), 120, 60)
    const tokenHash = await sha256Hex(token)
    await enforceRateLimit(supabase, `quote-token:${tokenHash.slice(0, 24)}`, 60, 60)

    const { data: link, error: linkError } = await supabase
      .from('quote_links')
      .select('quote_id, organization_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (linkError) throw new HttpError(503, 'quote_lookup_failed')
    if (!link) return unavailable(req)

    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, organization_id, customer_id, public_reference, status, valid_until, notes, total_cents, order_id, created_at')
      .eq('id', link.quote_id)
      .eq('organization_id', link.organization_id)
      .maybeSingle()
    if (quoteError) throw new HttpError(503, 'quote_lookup_failed')
    if (!quote) return unavailable(req)

    const terminal = quote.status === 'accepted' || quote.status === 'declined'
    const linkExpired = new Date(link.expires_at).getTime() <= Date.now()
    if (!terminal && (link.revoked_at || linkExpired)) return unavailable(req)

    if (!terminal) {
      const { data: entitled, error: entitlementError } = await supabase.rpc(
        'api_assert_entitlement',
        { p_organization_id: quote.organization_id, p_feature_key: 'quotes' },
      )
      if (entitlementError) throw new HttpError(503, 'entitlement_check_failed')
      if (entitled !== true) return unavailable(req)
    }

    const [organization, customerResult, itemsResult, orderResult] = await Promise.all([
      findPublicOrganizationById(supabase, quote.organization_id),
      supabase
        .from('customers')
        .select('display_name')
        .eq('organization_id', quote.organization_id)
        .eq('id', quote.customer_id)
        .maybeSingle(),
      supabase
        .from('quote_items')
        .select('name_snapshot, unit_snapshot, quantity, unit_price_cents, subtotal_cents')
        .eq('organization_id', quote.organization_id)
        .eq('quote_id', quote.id)
        .order('created_at', { ascending: true }),
      quote.order_id
        ? supabase
            .from('orders')
            .select('public_reference')
            .eq('organization_id', quote.organization_id)
            .eq('id', quote.order_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (customerResult.error || itemsResult.error || orderResult.error || !organization) {
      throw new HttpError(503, 'quote_lookup_failed')
    }
    if (!customerResult.data) return unavailable(req)

    const expired = quote.status === 'sent' && new Date(quote.valid_until).getTime() <= Date.now()
    const status = expired ? 'expired' : quote.status

    return jsonResponse(
      req,
      {
        supplier: {
          name: organization.name,
          slug: organization.slug,
          whatsapp: organization.whatsapp,
        },
        customer: { name: customerResult.data.display_name },
        reference: quote.public_reference,
        status,
        valid_until: quote.valid_until,
        notes: quote.notes,
        items: (itemsResult.data ?? []).map((item) => ({
          name: item.name_snapshot,
          unit: item.unit_snapshot,
          quantity: item.quantity,
          unit_price_cents: item.unit_price_cents,
          subtotal_cents: item.subtotal_cents,
        })),
        total_cents: quote.total_cents,
        created_at: quote.created_at,
        order_reference: orderResult.data?.public_reference ?? null,
        can_accept: status === 'sent' && new Date(quote.valid_until).getTime() > Date.now(),
      },
      200,
      QUOTE_HEADERS,
    )
  })

if (import.meta.main) Deno.serve(handler)
