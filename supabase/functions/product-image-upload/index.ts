import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier, assertWriteAccess , assertRole} from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import { isUuid } from '../_shared/validation.ts'
import {
  MAX_IMAGE_BYTES,
  MAX_THUMB_BYTES,
  validateAltText,
  validateImageBytes,
  type ImageMime,
} from '../_shared/image.ts'

const MAX_FORM_BYTES = MAX_IMAGE_BYTES + MAX_THUMB_BYTES + 512 * 1024
const BUCKET = 'product-images'

interface UploadForm {
  productId: string
  altText: string
  isCover: boolean
  image: File
  thumb: File | null
}

interface ValidatedFiles {
  imageBytes: Uint8Array
  imageMime: ImageMime
  imageExtension: string
  thumbBytes: Uint8Array | null
  thumbMime: ImageMime | null
  thumbExtension: string | null
}

function formFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File ? value : null
}

async function readUploadForm(req: Request): Promise<UploadForm> {
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'Imagem acima do limite permitido.')
  }

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
    throw new HttpError(400, 'invalid_alt_text', 'Descreva a imagem em 3 a 160 caracteres.')
  }

  const image = formFile(form.get('image'))
  if (!image) throw new HttpError(400, 'image_required', 'Imagem ausente.')

  const coverValue = form.get('is_cover')
  return {
    productId,
    altText,
    isCover: typeof coverValue === 'string' && coverValue === 'true',
    image,
    thumb: formFile(form.get('thumb')),
  }
}

async function loadProduct(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name')
    .eq('id', productId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw new HttpError(503, 'product_lookup_failed')
  if (!data) throw new HttpError(404, 'product_not_found', 'Produto não encontrado.')
  return data
}

async function assertImageLimit(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string,
): Promise<void> {
  const { count, error } = await supabase
    .from('product_images')
    .select('*', { count: 'exact', head: true })
    .eq('product_id', productId)
    .eq('organization_id', organizationId)
  if (error) throw new HttpError(503, 'image_count_failed')
  if ((count ?? 0) >= 8) {
    throw new HttpError(409, 'image_limit_reached', 'Limite de 8 imagens por produto.')
  }
}

async function validateFiles(form: UploadForm): Promise<ValidatedFiles> {
  const imageBytes = new Uint8Array(await form.image.arrayBuffer())
  const imageValidation = validateImageBytes(imageBytes, form.image.type, MAX_IMAGE_BYTES)
  if (!imageValidation.ok) {
    throw new HttpError(400, 'invalid_image', 'Imagem inválida ou acima de 5 MB.', {
      reason: imageValidation.reason,
    })
  }

  if (!form.thumb) {
    return {
      imageBytes,
      imageMime: imageValidation.mime,
      imageExtension: imageValidation.extension,
      thumbBytes: null,
      thumbMime: null,
      thumbExtension: null,
    }
  }

  const thumbBytes = new Uint8Array(await form.thumb.arrayBuffer())
  const thumbValidation = validateImageBytes(thumbBytes, form.thumb.type, MAX_THUMB_BYTES)
  if (!thumbValidation.ok) {
    throw new HttpError(400, 'invalid_thumb', 'Miniatura inválida.', {
      reason: thumbValidation.reason,
    })
  }

  return {
    imageBytes,
    imageMime: imageValidation.mime,
    imageExtension: imageValidation.extension,
    thumbBytes,
    thumbMime: thumbValidation.mime,
    thumbExtension: thumbValidation.extension,
  }
}

async function uploadFiles(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string,
  form: UploadForm,
  files: ValidatedFiles,
): Promise<{ imagePath: string; thumbPath: string | null }> {
  const imagePath = `${organizationId}/${productId}/${crypto.randomUUID()}.${files.imageExtension}`
  const thumbPath =
    files.thumbBytes && files.thumbMime && files.thumbExtension
      ? `${organizationId}/${productId}/${crypto.randomUUID()}.${files.thumbExtension}`
      : null
  const bucket = supabase.storage.from(BUCKET)

  const imageUpload = await bucket.upload(imagePath, form.image, {
    contentType: files.imageMime,
    upsert: false,
  })
  if (imageUpload.error) {
    throw new HttpError(502, 'storage_upload_failed', 'Não foi possível salvar a imagem.')
  }

  if (thumbPath && form.thumb && files.thumbMime) {
    const thumbUpload = await bucket.upload(thumbPath, form.thumb, {
      contentType: files.thumbMime,
      upsert: false,
    })
    if (thumbUpload.error) {
      await bucket.remove([imagePath]).catch(() => undefined)
      throw new HttpError(502, 'storage_upload_failed', 'Não foi possível salvar a miniatura.')
    }
  }

  return { imagePath, thumbPath }
}

async function saveImage(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string,
  actorId: string,
  form: UploadForm,
  paths: { imagePath: string; thumbPath: string | null },
): Promise<unknown> {
  const { data, error } = await supabase.rpc('api_add_product_image', {
    p_organization_id: organizationId,
    p_product_id: productId,
    p_storage_path: paths.imagePath,
    p_thumb_path: paths.thumbPath,
    p_alt_text: form.altText,
    p_position: 0,
    p_is_cover: form.isCover,
    p_actor: actorId,
  })

  if (error) {
    const remove = [paths.imagePath, paths.thumbPath].filter(Boolean) as string[]
    await supabase.storage.from(BUCKET).remove(remove).catch(() => undefined)
    throw new HttpError(500, 'image_save_failed', 'Não foi possível registrar a imagem.')
  }

  return Array.isArray(data) ? data[0] : data
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'product-image-upload', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager'])
    await assertWriteAccess(supabase, organization.id)
    await enforceRateLimit(supabase, `product-image:${organization.id}`, 60, 3600)

    const form = await readUploadForm(req)
    await loadProduct(supabase, organization.id, form.productId)
    await assertImageLimit(supabase, organization.id, form.productId)

    const files = await validateFiles(form)
    const paths = await uploadFiles(supabase, organization.id, form.productId, form, files)
    const row = await saveImage(
      supabase,
      organization.id,
      form.productId,
      user.id,
      form,
      paths,
    )

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'product.image_added',
      entity: 'product',
      entityId: form.productId,
      metadata: { image_id: (row as { id?: string } | null)?.id ?? null, cover: form.isCover },
    })

    return jsonResponse(req, { image: row }, 201)
  })

if (import.meta.main) Deno.serve(handler)
