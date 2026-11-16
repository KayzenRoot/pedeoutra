import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { HttpError, logError } from './http.ts'

export interface CatalogImage {
  id: string
  alt_text: string
  is_cover: boolean
  position: number
  storage_path: string
  thumb_path: string | null
}

export interface CatalogProduct {
  id: string
  name: string
  unit: string
  price_cents: number | null
  sku: string | null
  min_quantity: number
  quantity_increment: number
  category_id: string | null
  product_images: CatalogImage[] | null
}

export interface CatalogCategory {
  id: string
  name: string
  slug: string
  position: number
}

const PRODUCT_SELECT =
  'id, name, unit, price_cents, sku, min_quantity, quantity_increment, category_id, product_images(id, alt_text, is_cover, position, storage_path, thumb_path)'

export async function loadCatalog(
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
      .select(PRODUCT_SELECT)
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

export async function signImagePaths(
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

export function mapProducts(products: CatalogProduct[], signed: Map<string, string>) {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    unit: product.unit,
    price_cents: product.price_cents,
    sku: product.sku,
    min_quantity: product.min_quantity,
    quantity_increment: product.quantity_increment,
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
