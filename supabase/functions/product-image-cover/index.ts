import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier, assertWriteAccess } from '../_shared/auth.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isUuid } from '../_shared/validation.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'product-image-cover', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.image_id)) {
      throw new HttpError(400, 'invalid_image', 'Imagem inválida.')
    }

    const { error } = await supabase.rpc('api_set_product_image_cover', {
      p_organization_id: organization.id,
      p_image_id: body.image_id,
    })
    if (error) {
      if (String(error.message).includes('image_not_found')) {
        throw new HttpError(404, 'image_not_found', 'Imagem não encontrada.')
      }
      throw new HttpError(500, 'image_cover_failed')
    }

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'product.image_cover_set',
      entity: 'product',
      entityId: body.image_id as string,
    })

    return jsonResponse(req, { ok: true })
  })

if (import.meta.main) Deno.serve(handler)
