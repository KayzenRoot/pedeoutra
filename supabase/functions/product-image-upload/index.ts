import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier, assertWriteAccess } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import { isUuid } from '../_shared/validation.ts'
import {
  MAX_IMAGE_BYTES,
  MAX_THUMB_BYTES,
  validateAltText,
  validateImageBytes,
} from '../_shared/image.ts'

const MAX_FORM_BYTES = MAX_IMAGE_BYTES + MAX_THUMB_BYTES + 512 * 1024
const BUCKET = 'product-images'

function formFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File ? value : null
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'product-image-upload', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) {
      throw new HttpError(413, 'payload_too_large', 'Imagem acima do limite permitido.')
    }

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)
    await enforceRateLimit(supabase, `product-image:${organization.id}`, 60, 3600)

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      throw new HttpError(400, 'invalid_form', 'Envie a imagem em multipart/form-data.')
    }

    const productId = form.get('product_id')
    if (!isUuid(productId)) throw new HttpError(400, 'invalid_product', 'Produto inválido.')

    const altText = validateAltText(form.get('alt_text'))
    if (!altText) {
      throw new HttpError(
        400,
        'invalid_alt_text',
        'Descreva a imagem em 3 a 160 caracteres.',
      )
    }

    const image = formFile(form.get('image'))
    const thumb = formFile(form.get('thumb'))
    if (!image) throw new HttpError(400, 'image_required', 'Imagem ausente.')

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', productId)
      .eq('organization_id', organization.id)
      .maybeSingle()
    if (productError) throw new HttpError(503, 'product_lookup_failed')
    if (!product) throw new HttpError(404, 'product_not_found', 'Produto não encontrado.')

    const { count, error: countError } = await supabase
      .from('product_images')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', productId)
      .eq('organization_id', organization.id)
    if (countError) throw new HttpError(503, 'image_count_failed')
    if ((count ?? 0) >= 8) {
      throw new HttpError(409, 'image_limit_reached', 'Limite de 8 imagens por produto.')
    }

    const imageBytes = new Uint8Array(await image.arrayBuffer())
    const imageValidation = validateImageBytes(imageBytes, image.type, MAX_IMAGE_BYTES)
    if (!imageValidation.ok) {
      throw new HttpError(400, 'invalid_image', 'Imagem inválida ou acima de 5 MB.', {
        reason: imageValidation.reason,
      })
    }

    let thumbBytes: Uint8Array | null = null
    let thumbMime: string | null = null
    let thumbExtension: string | null = null
    if (thumb) {
      thumbBytes = new Uint8Array(await thumb.arrayBuffer())
      const thumbValidation = validateImageBytes(thumbBytes, thumb.type, MAX_THUMB_BYTES)
      if (!thumbValidation.ok) {
        throw new HttpError(400, 'invalid_thumb', 'Miniatura inválida.', {
          reason: thumbValidation.reason,
        })
      }
      thumbMime = thumbValidation.mime
      thumbExtension = thumbValidation.extension
    }

    const imageId = crypto.randomUUID()
    const imagePath = `${organization.id}/${productId}/${imageId}.${imageValidation.extension}`
    const thumbPath =
      thumbBytes && thumbMime && thumbExtension
        ? `${organization.id}/${productId}/${crypto.randomUUID()}.${thumbExtension}`
        : null

    const bucket = supabase.storage.from(BUCKET)
    const imageUpload = await bucket.upload(imagePath, image, {
      contentType: imageValidation.mime,
      upsert: false,
    })
    if (imageUpload.error) {
      throw new HttpError(502, 'storage_upload_failed', 'Não foi possível salvar a imagem.')
    }

    if (thumbPath && thumbBytes && thumbMime && thumb) {
      const thumbUpload = await bucket.upload(thumbPath, thumb, {
        contentType: thumbMime,
        upsert: false,
      })
      if (thumbUpload.error) {
        await bucket.remove([imagePath]).catch(() => undefined)
        throw new HttpError(502, 'storage_upload_failed', 'Não foi possível salvar a miniatura.')
      }
    }

    const isCover = String(form.get('is_cover') ?? '') === 'true'
    const { data, error } = await supabase.rpc('api_add_product_image', {
      p_organization_id: organization.id,
      p_product_id: productId,
      p_storage_path: imagePath,
      p_thumb_path: thumbPath,
      p_alt_text: altText,
      p_position: 0,
      p_is_cover: isCover,
      p_actor: user.id,
    })

    if (error) {
      const paths = [imagePath, thumbPath].filter(Boolean) as string[]
      await bucket.remove(paths).catch(() => undefined)
      throw new HttpError(500, 'image_save_failed', 'Não foi possível registrar a imagem.')
    }

    const row = Array.isArray(data) ? data[0] : data
    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'product.image_added',
      entity: 'product',
      entityId: productId,
      metadata: { image_id: row?.id ?? imageId, cover: isCover },
    })

    return jsonResponse(req, { image: row }, 201)
  })

if (import.meta.main) Deno.serve(handler)
