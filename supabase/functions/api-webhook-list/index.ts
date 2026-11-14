import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'api-webhook-list', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const supabase = adminClient()
    const { organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])

    const { data, error } = await supabase
      .from('api_webhooks')
      .select('id, url, events, status, created_at, last_delivery_at, last_error')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
    if (error) throw new HttpError(503, 'webhook_lookup_failed')

    return jsonResponse(req, { webhooks: data ?? [] })
  })

if (import.meta.main) Deno.serve(handler)
