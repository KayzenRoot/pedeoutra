import { adminClient } from '../_shared/supabase.ts'
import { findPublicOrganizationById } from '../_shared/org.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { loadCatalog, mapProducts, signImagePaths } from '../_shared/catalog.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  withHttpErrors,
} from '../_shared/http.ts'
import { isValidReorderToken, sha256Hex } from '../_shared/tokens.ts'

const PRIVATE_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

function unavailable(req: Request): Response {
  return jsonResponse(
    req,
    {
      error: 'price_link_unavailable',
      message: 'Este link de preços não está mais disponível.',
    },
    404,
    PRIVATE_HEADERS,
  )
}

interface PriceItem {
  product_id: string
  price_cents: number
  valid_from: string
  valid_until: string | null
}

async function loadPrivatePrices(
  supabase: ReturnType<typeof adminClient>,
  organizationId: string,
  customerId: string,
  at: Date,
): Promise<{
  priceList: { id: string; name: string } | null
  prices: Map<string, number>
}> {
  const { data: assignment, error: assignmentError } = await supabase
    .from('customer_price_list_assignments')
    .select('price_list_id')
    .eq('organization_id', organizationId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (assignmentError) throw new HttpError(503, 'price_list_lookup_failed')
  if (!assignment) return { priceList: null, prices: new Map() }

  const { data: list, error: listError } = await supabase
    .from('price_lists')
    .select('id, name, active')
    .eq('organization_id', organizationId)
    .eq('id', assignment.price_list_id)
    .maybeSingle()
  if (listError) throw new HttpError(503, 'price_list_lookup_failed')
  if (!list || !list.active) return { priceList: null, prices: new Map() }

  const { data: items, error: itemsError } = await supabase
    .from('price_list_items')
    .select('product_id, price_cents, valid_from, valid_until')
    .eq('organization_id', organizationId)
    .eq('price_list_id', list.id)
  if (itemsError) throw new HttpError(503, 'price_list_lookup_failed')

  const prices = new Map<string, number>()
  for (const item of (items ?? []) as PriceItem[]) {
    const from = new Date(item.valid_from).getTime()
    const until = item.valid_until ? new Date(item.valid_until).getTime() : null
    if (from <= at.getTime() && (until === null || until > at.getTime())) {
      prices.set(item.product_id, item.price_cents)
    }
  }

  return { priceList: { id: list.id, name: list.name }, prices }
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'private-catalog-get', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const url = new URL(req.url)
    const token = (url.searchParams.get('token') ?? '').trim()
    if (!isValidReorderToken(token)) return unavailable(req)

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'private-catalog'), 120, 60)

    const tokenHash = await sha256Hex(token)
    await enforceRateLimit(supabase, `private-token:${tokenHash.slice(0, 24)}`, 60, 60)

    const { data: link, error: linkError } = await supabase
      .from('customer_price_tokens')
      .select('organization_id, customer_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (linkError) throw new HttpError(503, 'price_link_lookup_failed')
    if (!link || link.revoked_at) return unavailable(req)
    if (new Date(link.expires_at).getTime() <= Date.now()) return unavailable(req)

    const { data: entitled, error: entitlementError } = await supabase.rpc(
      'api_assert_entitlement',
      {
        p_organization_id: link.organization_id,
        p_feature_key: 'private_prices',
      },
    )
    if (entitlementError) throw new HttpError(503, 'entitlement_check_failed')
    if (entitled !== true) return unavailable(req)

    const organization = await findPublicOrganizationById(supabase, link.organization_id)
    if (!organization) return unavailable(req)

    const [customerResult, catalog] = await Promise.all([
      supabase
        .from('customers')
        .select('display_name')
        .eq('organization_id', link.organization_id)
        .eq('id', link.customer_id)
        .maybeSingle(),
      loadCatalog(supabase, link.organization_id),
    ])
    if (customerResult.error) throw new HttpError(503, 'customer_lookup_failed')
    if (!customerResult.data) return unavailable(req)

    const { priceList, prices } = await loadPrivatePrices(
      supabase,
      link.organization_id,
      link.customer_id,
      new Date(),
    )
    if (!priceList) return unavailable(req)
    const signed = await signImagePaths(supabase, catalog.products)

    return jsonResponse(
      req,
      {
        organization: {
          name: organization.name,
          slug: organization.slug,
          city: organization.city,
          whatsapp: organization.whatsapp,
          min_order_cents: organization.min_order_cents,
          min_order_items: organization.min_order_items,
        },
        customer: { name: customerResult.data.display_name },
        price_list: priceList,
        categories: catalog.categories,
        products: mapProducts(catalog.products, signed).map((product) => {
          const privatePrice = prices.get(product.id)
          if (privatePrice === undefined) {
            return { ...product, price_source: 'public' }
          }
          return { ...product, price_cents: privatePrice, price_source: 'private' }
        }),
        accepting_orders: organization.accepting_orders,
        expires_at: link.expires_at,
      },
      200,
      PRIVATE_HEADERS,
    )
  })

if (import.meta.main) Deno.serve(handler)
