import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier, assertWriteAccess } from '../_shared/auth.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isUuid } from '../_shared/validation.ts'

const BUCKET = 'product-images'

export const handler = (req: Request) =>
  withHttpErrors(req, 'product-image-delete', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.image_id)) {
      throw new HttpError(400, 'invalid_image', 'Imagem inválida.')
    }

    const { data, error } = await supabase.rpc('api_delete_product_image', {
      p_organization_id: organization.id,
      p_image_id: body.image_id,
    })
    if (error) {
      if (String(error.message).includes('image_not_found')) {
        throw new HttpError(404, 'image_not_found', 'Imagem não encontrada.')
      }
      throw new HttpError(500, 'image_delete_failed')
    }

    const row = Array.isArray(data) ? data[0] : data
    const paths = [row?.storage_path, row?.thumb_path].filter(Boolean) as string[]
    let storageCleanup = true
    if (paths.length > 0) {
      const removed = await supabase.storage.from(BUCKET).remove(paths)
      if (removed.error) {
        storageCleanup = false
        logError('product_image_storage_cleanup', removed.error)
      }
    }

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'product.image_removed',
      entity: 'product',
      entityId: body.image_id as string,
      metadata: { storage_cleanup: storageCleanup },
    })

    return jsonResponse(req, { deleted: true, storage_cleanup: storageCleanup })
  })

if (import.meta.main) Deno.serve(handler)
