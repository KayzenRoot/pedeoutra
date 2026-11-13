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

    const [categoriesResult, productsResult] = await Promise.all([
      supabase
        .from('product_categories')
        .select('id, name, slug, position')
        .eq('organization_id', organization.id)
        .eq('active', true)
        .order('position', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('products')
        .select(
          'id, name, unit, price_cents, category_id, product_images(id, alt_text, is_cover, position, storage_path, thumb_path)',
        )
        .eq('organization_id', organization.id)
        .eq('active', true)
        .order('name', { ascending: true }),
    ])

    if (categoriesResult.error || productsResult.error) {
      throw new HttpError(500, 'catalog_lookup_failed')
    }

    const products = productsResult.data ?? []
    const paths = products.flatMap((product) =>
      (product.product_images ?? []).flatMap((image) =>
        [image.storage_path, image.thumb_path].filter(Boolean),
      ),
    ) as string[]
    const signed = new Map<string, string>()
    if (paths.length > 0) {
      const { data: urls, error: signError } = await supabase.storage
        .from('product-images')
        .createSignedUrls(paths, 3600)
      if (signError) {
        logError('catalog_image_sign', signError)
      } else {
        for (const item of urls ?? []) {
          if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl)
        }
      }
    }

    return jsonResponse(req, {
      organization: {
        name: organization.name,
        slug: organization.slug,
        city: organization.city,
        whatsapp: organization.whatsapp,
      },
      categories: categoriesResult.data ?? [],
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        unit: product.unit,
        price_cents: product.price_cents,
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
      })),
      accepting_orders: organization.accepting_orders,
    })
  })

if (import.meta.main) Deno.serve(handler)
