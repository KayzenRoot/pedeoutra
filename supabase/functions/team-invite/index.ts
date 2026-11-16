import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import { assertEntitlement } from '../_shared/entitlements.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  appBaseUrl,
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { parseTeamInviteInput } from '../_shared/validation.ts'
import { generateReorderToken, sha256Hex } from '../_shared/tokens.ts'

const TTL_DAYS = 7

export const handler = (req: Request) =>
  withHttpErrors(req, 'team-invite', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])
    await assertEntitlement(supabase, organization.id, 'team')
    await enforceRateLimit(supabase, `team-invite:${organization.id}`, 20, 3600)

    const parsed = parseTeamInviteInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Revise o e-mail e o papel do convite.')
    }

    const token = generateReorderToken()
    const tokenHash = await sha256Hex(token)
    const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.rpc('api_create_invitation', {
      p_organization_id: organization.id,
      p_actor_user_id: user.id,
      p_email: parsed.value.email,
      p_role: parsed.value.role,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
    })
    if (error) {
      if (error.message.includes('team_limit_reached')) {
        throw new HttpError(409, 'team_limit_reached', 'O limite de 3 usuários foi atingido.')
      }
      if (error.message.includes('plan_required')) {
        throw new HttpError(403, 'plan_required', 'A equipe exige o plano Profissional ativo.')
      }
      if (error.message.includes('invalid_email') || error.message.includes('invalid_role')) {
        throw new HttpError(400, 'invalid_invitation', 'Revise o e-mail e o papel do convite.')
      }
      throw new HttpError(500, 'invitation_failed')
    }

    const invitation = Array.isArray(data) ? data[0] : data
    return jsonResponse(
      req,
      {
        invitation_id: invitation?.invitation_id,
        url: `${appBaseUrl()}/convite/${token}`,
        expires_at: invitation?.expires_at ?? expiresAt,
        email_sent: false,
        delivery: 'manual',
        message:
          'O e-mail não foi enviado porque o SMTP ainda não está configurado. Copie o link e envie ao convidado por um canal seguro.',
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
