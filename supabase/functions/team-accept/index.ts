import { adminClient } from '../_shared/supabase.ts'
import { requireAuthenticatedUser } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { parseTeamAcceptInput } from '../_shared/validation.ts'
import { sha256Hex } from '../_shared/tokens.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'team-accept', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const user = await requireAuthenticatedUser(req, supabase)
    await enforceRateLimit(supabase, await rateBucket(req, 'team-accept'), 20, 600)

    const parsed = parseTeamAcceptInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Convite inválido.')
    }
    const tokenHash = await sha256Hex(parsed.value.token)
    const { data, error } = await supabase.rpc('api_accept_invitation', {
      p_token_hash: tokenHash,
      p_actor_user_id: user.id,
    })
    if (error) {
      if (error.message.includes('invitation_unavailable')) {
        throw new HttpError(404, 'invitation_unavailable', 'Convite inválido ou expirado.')
      }
      if (error.message.includes('invitation_email_mismatch')) {
        throw new HttpError(403, 'invitation_email_mismatch', 'Este convite é para outro e-mail.')
      }
      if (error.message.includes('email_not_verified')) {
        throw new HttpError(403, 'email_not_verified', 'Confirme seu e-mail antes de aceitar.')
      }
      if (error.message.includes('plan_required')) {
        throw new HttpError(403, 'plan_required', 'A equipe exige o plano Profissional ativo.')
      }
      if (error.message.includes('already_in_team')) {
        throw new HttpError(409, 'already_in_team', 'Sua conta já pertence a uma equipe.')
      }
      throw new HttpError(500, 'invitation_accept_failed')
    }

    const accepted = Array.isArray(data) ? data[0] : data
    return jsonResponse(req, {
      organization_id: accepted?.organization_id,
      role: accepted?.role,
    })
  })

if (import.meta.main) Deno.serve(handler)
