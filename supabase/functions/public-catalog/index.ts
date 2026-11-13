import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient } from '../_shared/supabase.ts'
import { findPublicOrganization } from '../_shared/org.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  rateBucket,
  withHttpErrors,
} from '../_shared/http.ts'

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

interface CatalogImage {
  id: string
  alt_text: string
  is_cover: boolean
  position: number
  storage_path: string
  thumb_path: string | null
}

interface CatalogProduct {
  id: string
  name: string
  unit: string
  price_cents: number | null
  sku: string | null
  category_id: string | null
  product_images: CatalogImage[] | null
}

interface CatalogCategory {
  id: string
  name: string
  slug: string
  position: number
}

async function loadCatalog(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ categories: CatalogCategory[]; products: CatalogProduct[] }> {
  const [categoriesResult, productsResult] = await Promise.all([
    supabase
      .from('product_categories')
      .select('id, name, slug, position')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('products')
      .select(
        'id, name, unit, price_cents, sku, category_id, product_images(id, alt_text, is_cover, position, storage_path, thumb_path)',
      )
      .eq('organization_id', organizationId)
      .eq('active', true)
      .order('name', { ascending: true }),
  ])

  if (categoriesResult.error || productsResult.error) {
    throw new HttpError(500, 'catalog_lookup_failed')
  }

  return {
    categories: (categoriesResult.data ?? []) as CatalogCategory[],
    products: (productsResult.data ?? []) as CatalogProduct[],
  }
}

async function signImagePaths(
  supabase: SupabaseClient,
  products: CatalogProduct[],
): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  const paths = products.flatMap((product) =>
    (product.product_images ?? []).flatMap((image) =>
      [image.storage_path, image.thumb_path].filter(Boolean),
    ),
  ) as string[]

  if (paths.length === 0) return signed

  const { data, error } = await supabase.storage
    .from('product-images')
    .createSignedUrls(paths, 3600)
  if (error) {
    logError('catalog_image_sign', error)
    return signed
  }

  for (const item of data ?? []) {
    if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl)
  }
  return signed
}

function mapProducts(products: CatalogProduct[], signed: Map<string, string>) {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    unit: product.unit,
    price_cents: product.price_cents,
    sku: product.sku,
    category_id: product.category_id,
    images: [...(product.product_images ?? [])]
      .sort(
        (a, b) =>
          Number(b.is_cover) - Number(a.is_cover) ||
          Number(a.position) - Number(b.position),
      )
      .map((image) => ({
        id: image.id,
        alt_text: image.alt_text,
        is_cover: image.is_cover,
        url: signed.get(image.storage_path) ?? null,
        thumb_url: image.thumb_path ? (signed.get(image.thumb_path) ?? null) : null,
      })),
  }))
}

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
      },
      categories,
      products: mapProducts(products, signed),
      accepting_orders: organization.accepting_orders,
    })
  })

if (import.meta.main) Deno.serve(handler)
