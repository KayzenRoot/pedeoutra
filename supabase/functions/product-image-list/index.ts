import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier } from '../_shared/auth.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'

const BUCKET = 'product-images'

export const handler = (req: Request) =>
  withHttpErrors(req, 'product-image-list', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const supabase = adminClient()
    const { organization } = await requireSupplier(req, supabase)

    const { data, error } = await supabase
      .from('product_images')
      .select('id, product_id, alt_text, position, is_cover, storage_path, thumb_path, created_at')
      .eq('organization_id', organization.id)
      .order('product_id', { ascending: true })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw new HttpError(500, 'image_lookup_failed')

    const rows = data ?? []
    const paths = rows.flatMap((row) =>
      [row.storage_path, row.thumb_path].filter(Boolean),
    ) as string[]
    const signed = new Map<string, string>()
    if (paths.length > 0) {
      const { data: urls, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600)
      if (signError) {
        logError('product_image_list_sign', signError)
      } else {
        for (const item of urls ?? []) {
          if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl)
        }
      }
    }

    return jsonResponse(req, {
      images: rows.map((row) => ({
        id: row.id,
        product_id: row.product_id,
        alt_text: row.alt_text,
        position: row.position,
        is_cover: row.is_cover,
        url: signed.get(row.storage_path) ?? null,
        thumb_url: row.thumb_path ? (signed.get(row.thumb_path) ?? null) : null,
      })),
    })
  })

if (import.meta.main) Deno.serve(handler)
