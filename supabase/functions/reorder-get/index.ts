import { adminClient } from '../_shared/supabase.ts'
import { findPublicOrganizationById } from '../_shared/org.ts'
import { consumeRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  appBaseUrl,
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isValidReorderToken, sha256Hex } from '../_shared/tokens.ts'
import { isRecord } from '../_shared/validation.ts'

interface TemplateItem {
  product_id: string
  quantity: number
}

function parseTemplate(value: unknown): TemplateItem[] {
  if (!Array.isArray(value)) return []
  const items: TemplateItem[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    if (typeof raw.product_id !== 'string') continue
    if (typeof raw.quantity !== 'number' || !Number.isInteger(raw.quantity)) continue
    if (raw.quantity < 1 || raw.quantity > 999) continue
    items.push({ product_id: raw.product_id, quantity: raw.quantity })
  }
  return items
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'reorder-get', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const body = await readJson(req)
    if (!isRecord(body) || !isValidReorderToken(body.token)) {
      throw new HttpError(404, 'link_unavailable', 'Este link não está mais disponível.')
    }

    const supabase = adminClient()
    const tokenHash = await sha256Hex(body.token)

    const tokenAllowed = await consumeRateLimit(
      supabase,
      `reorder-get-token:${tokenHash}`,
      30,
      600,
    )
    const ipAllowed = await consumeRateLimit(
      supabase,
      await rateBucket(req, 'reorder-get'),
      60,
      60,
    )
    if (!tokenAllowed || !ipAllowed) {
      throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos.')
    }

    const { data: link, error } = await supabase
      .from('reorder_links')
      .select('id, organization_id, template_json, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (error) throw new HttpError(500, 'link_lookup_failed')
    if (!link) {
      throw new HttpError(404, 'link_unavailable', 'Este link não está mais disponível.')
    }
    if (link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) {
      const expiredOrganization = await findPublicOrganizationById(
        supabase,
        link.organization_id,
      )
      throw new HttpError(
        410,
        'link_unavailable',
        'Este link não está mais disponível.',
        expiredOrganization
          ? { catalog_url: `${appBaseUrl()}/c/${expiredOrganization.slug}` }
          : undefined,
      )
    }

    const organization = await findPublicOrganizationById(supabase, link.organization_id)
    if (!organization) {
      throw new HttpError(404, 'link_unavailable', 'Este link não está mais disponível.')
    }

    const template = parseTemplate(link.template_json)
    const productIds = template.map((item) => item.product_id)

    let products: Array<{
      id: string
      name: string
      unit: string
      price_cents: number | null
    }> = []

    if (productIds.length > 0) {
      const { data: productRows, error: productError } = await supabase
        .from('products')
        .select('id, name, unit, price_cents')
        .eq('organization_id', organization.id)
        .eq('active', true)
        .in('id', productIds)

      if (productError) throw new HttpError(500, 'catalog_lookup_failed')
      products = productRows ?? []
    }

    const productMap = new Map(products.map((product) => [product.id, product]))
    const items = template
      .map((item) => {
        const product = productMap.get(item.product_id)
        if (!product) return null
        return {
          product_id: product.id,
          name: product.name,
          unit: product.unit,
          price_cents: product.price_cents,
          quantity: item.quantity,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

    return jsonResponse(req, {
      supplier: {
        name: organization.name,
        slug: organization.slug,
        city: organization.city,
        whatsapp: organization.whatsapp,
      },
      items,
      accepting_orders: organization.accepting_orders,
      expires_at: link.expires_at,
      catalog_url: `${appBaseUrl()}/c/${organization.slug}`,
    })
  })

if (import.meta.main) Deno.serve(handler)
