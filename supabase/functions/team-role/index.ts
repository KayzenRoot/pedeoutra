import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { parseTeamRoleInput } from '../_shared/validation.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'team-role', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])

    const parsed = parseTeamRoleInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Papel inválido.')
    }
    const { data, error } = await supabase.rpc('api_change_member_role', {
      p_organization_id: organization.id,
      p_actor_user_id: user.id,
      p_membership_id: parsed.value.membershipId,
      p_role: parsed.value.role,
    })
    if (error) {
      if (error.message.includes('owner_membership_protected')) {
        throw new HttpError(403, 'owner_protected', 'O proprietário não pode ser alterado.')
      }
      if (error.message.includes('member_not_found')) {
        throw new HttpError(404, 'member_not_found', 'Membro não encontrado.')
      }
      throw new HttpError(500, 'role_change_failed')
    }

    const changed = Array.isArray(data) ? data[0] : data
    return jsonResponse(req, { membership_id: changed?.membership_id, role: changed?.role })
  })

if (import.meta.main) Deno.serve(handler)
