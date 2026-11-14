import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'api-key-list', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const supabase = adminClient()
    const { organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, name, key_prefix, scopes, status, created_at, last_used_at, revoked_at, expires_at')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
    if (error) throw new HttpError(503, 'api_key_lookup_failed')

    return jsonResponse(req, { keys: data ?? [] })
  })

if (import.meta.main) Deno.serve(handler)
