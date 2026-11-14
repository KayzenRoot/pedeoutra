import { adminClient } from '../_shared/supabase.ts'
import { findPublicOrganization } from '../_shared/org.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { loadCatalog, mapProducts, signImagePaths } from '../_shared/catalog.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  withHttpErrors,
} from '../_shared/http.ts'

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const handler = (req: Request) =>
  withHttpErrors(req, 'public-catalog', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const url = new URL(req.url)
    const slug = (url.searchParams.get('slug') ?? '').trim()
    if (!SLUG_PATTERN.test(slug)) {
      throw new HttpError(400, 'invalid_slug', 'Catálogo inválido.')
    }

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'catalog'), 120, 60)

    const organization = await findPublicOrganization(supabase, slug)
    if (!organization) {
      throw new HttpError(404, 'catalog_not_found', 'Catálogo não encontrado.')
    }

    const { categories, products } = await loadCatalog(supabase, organization.id)
    const signed = await signImagePaths(supabase, products)

    return jsonResponse(req, {
      organization: {
        name: organization.name,
        slug: organization.slug,
        city: organization.city,
        whatsapp: organization.whatsapp,
        min_order_cents: organization.min_order_cents,
        min_order_items: organization.min_order_items,
      },
      categories,
      products: mapProducts(products, signed),
      accepting_orders: organization.accepting_orders,
    })
  })

if (import.meta.main) Deno.serve(handler)
