import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { parseTeamRevokeInput } from '../_shared/validation.ts'

async function revokeMembership(
  req: Request,
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  membershipId: string,
): Promise<Response> {
  const { data, error } = await supabase.rpc('api_revoke_member', {
    p_organization_id: organizationId,
    p_actor_user_id: userId,
    p_membership_id: membershipId,
  })
  if (error) {
    if (error.message.includes('owner_membership_protected')) {
      throw new HttpError(403, 'owner_protected', 'O proprietário não pode ser removido.')
    }
    if (error.message.includes('member_not_found')) {
      throw new HttpError(404, 'member_not_found', 'Membro não encontrado.')
    }
    throw new HttpError(500, 'member_revoke_failed')
  }
  const revoked = Array.isArray(data) ? data[0] : data
  return jsonResponse(req, { membership_id: revoked?.membership_id, status: revoked?.status })
}

async function revokeInvitation(
  req: Request,
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  invitationId: string,
): Promise<Response> {
  const { data, error } = await supabase.rpc('api_revoke_invitation', {
    p_organization_id: organizationId,
    p_actor_user_id: userId,
    p_invitation_id: invitationId,
  })
  if (error) {
    if (error.message.includes('invitation_not_found')) {
      throw new HttpError(404, 'invitation_not_found', 'Convite não encontrado.')
    }
    throw new HttpError(500, 'invitation_revoke_failed')
  }
  const revoked = Array.isArray(data) ? data[0] : data
  return jsonResponse(req, { invitation_id: revoked?.invitation_id, status: revoked?.status })
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'team-revoke', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])

    const parsed = parseTeamRevokeInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Selecione um membro ou convite.')
    }

    if (parsed.value.membershipId) {
      return revokeMembership(
        req,
        supabase,
        organization.id,
        user.id,
        parsed.value.membershipId,
      )
    }
    if (!parsed.value.invitationId) {
      throw new HttpError(400, 'invalid_revoke_target', 'Selecione um convite.')
    }
    return revokeInvitation(
      req,
      supabase,
      organization.id,
      user.id,
      parsed.value.invitationId,
    )
  })

if (import.meta.main) Deno.serve(handler)
