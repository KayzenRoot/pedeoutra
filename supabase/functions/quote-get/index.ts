import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
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

interface QuoteLink {
  quote_id: string
  organization_id: string
  expires_at: string
  revoked_at: string | null
}

interface Quote {
  id: string
  organization_id: string
  customer_id: string
  public_reference: string
  status: string
  valid_until: string
  notes: string | null
  total_cents: number
  order_id: string | null
  created_at: string
}

function unavailable(req: Request): Response {
  return jsonResponse(
    req,
    { error: 'quote_link_unavailable', message: 'Este orçamento não está mais disponível.' },
    404,
    QUOTE_HEADERS,
  )
}

function isTerminal(status: string): boolean {
  return status === 'accepted' || status === 'declined'
}

async function loadQuoteContext(
  supabase: SupabaseClient,
  tokenHash: string,
): Promise<{ link: QuoteLink; quote: Quote } | null> {
  const { data: link, error: linkError } = await supabase
    .from('quote_links')
    .select('quote_id, organization_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (linkError) throw new HttpError(503, 'quote_lookup_failed')
  if (!link) return null

  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select('id, organization_id, customer_id, public_reference, status, valid_until, notes, total_cents, order_id, created_at')
    .eq('id', link.quote_id)
    .eq('organization_id', link.organization_id)
    .maybeSingle()
  if (quoteError) throw new HttpError(503, 'quote_lookup_failed')
  if (!quote) return null
  return { link: link as QuoteLink, quote: quote as Quote }
}

async function canViewQuote(
  supabase: SupabaseClient,
  link: QuoteLink,
  quote: Quote,
): Promise<boolean> {
  const terminal = isTerminal(quote.status)
  const linkExpired = new Date(link.expires_at).getTime() <= Date.now()
  if (!terminal && (link.revoked_at || linkExpired)) return false
  if (terminal) return true

  const { data: entitled, error } = await supabase.rpc('api_assert_entitlement', {
    p_organization_id: quote.organization_id,
    p_feature_key: 'quotes',
  })
  if (error) throw new HttpError(503, 'entitlement_check_failed')
  return entitled === true
}

async function loadQuoteDetails(supabase: SupabaseClient, quote: Quote) {
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
  if (!customerResult.data) return null
  return {
    organization,
    customer: customerResult.data,
    items: itemsResult.data ?? [],
    orderReference: orderResult.data?.public_reference ?? null,
  }
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

    const context = await loadQuoteContext(supabase, tokenHash)
    if (!context || !(await canViewQuote(supabase, context.link, context.quote))) {
      return unavailable(req)
    }
    const details = await loadQuoteDetails(supabase, context.quote)
    if (!details) return unavailable(req)

    const expired =
      context.quote.status === 'sent' &&
      new Date(context.quote.valid_until).getTime() <= Date.now()
    const status = expired ? 'expired' : context.quote.status

    return jsonResponse(
      req,
      {
        supplier: {
          name: details.organization.name,
          slug: details.organization.slug,
          whatsapp: details.organization.whatsapp,
        },
        customer: { name: details.customer.display_name },
        reference: context.quote.public_reference,
        status,
        valid_until: context.quote.valid_until,
        notes: context.quote.notes,
        items: details.items.map((item) => ({
          name: item.name_snapshot,
          unit: item.unit_snapshot,
          quantity: item.quantity,
          unit_price_cents: item.unit_price_cents,
          subtotal_cents: item.subtotal_cents,
        })),
        total_cents: context.quote.total_cents,
        created_at: context.quote.created_at,
        order_reference: details.orderReference,
        can_accept: status === 'sent' && new Date(context.quote.valid_until).getTime() > Date.now(),
      },
      200,
      QUOTE_HEADERS,
    )
  })

if (import.meta.main) Deno.serve(handler)
