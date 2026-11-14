import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'team-list', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const supabase = adminClient()
    const { organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])

    const [membersResult, invitationsResult] = await Promise.all([
      supabase
        .from('organization_memberships')
        .select('id, email, role, status, created_at, revoked_at')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('organization_invitations')
        .select('id, email, role, expires_at, created_at, accepted_at, revoked_at')
        .eq('organization_id', organization.id)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ])
    if (membersResult.error || invitationsResult.error) {
      throw new HttpError(503, 'team_lookup_failed')
    }

    return jsonResponse(req, {
      members: membersResult.data ?? [],
      invitations: invitationsResult.data ?? [],
      limit: 3,
    })
  })

if (import.meta.main) Deno.serve(handler)
