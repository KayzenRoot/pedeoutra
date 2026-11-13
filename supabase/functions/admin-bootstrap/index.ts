import { adminClient } from '../_shared/supabase.ts'
import { requireAuthenticatedClaims } from '../_shared/admin.ts'
import { constantTimeEqual } from '../_shared/tokens.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'

/**
 * Bootstrap one-time do único superadmin.
 *
 * Requer cumulativamente: ADMIN_EMAIL no ambiente, token dedicado no header,
 * usuário autenticado com o mesmo e-mail e sessão AAL2/TOTP. Sem ADMIN_EMAIL,
 * falha fechado com ADMIN_BOOTSTRAP_BLOCKED. Nunca aceita e-mail vindo da URL.
 */
export const handler = (req: Request) =>
  withHttpErrors(req, 'admin-bootstrap', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const expectedEmail = (Deno.env.get('ADMIN_EMAIL') ?? '').trim().toLowerCase()
    const expectedToken = (Deno.env.get('ADMIN_BOOTSTRAP_TOKEN') ?? '').trim()

    if (!expectedEmail || !expectedToken) {
      throw new HttpError(
        503,
        'ADMIN_BOOTSTRAP_BLOCKED',
        'Bootstrap do superadmin indisponível: ADMIN_EMAIL/ADMIN_BOOTSTRAP_TOKEN não configurados.',
      )
    }

    const providedToken = (req.headers.get('x-admin-bootstrap-token') ?? '').trim()
    if (!constantTimeEqual(providedToken, expectedToken)) {
      throw new HttpError(401, 'unauthorized', 'Token de bootstrap inválido.')
    }

    const supabase = adminClient()
    const { userId, email } = await requireAuthenticatedClaims(req, supabase)

    if (!email || !constantTimeEqual(email, expectedEmail)) {
      throw new HttpError(
        403,
        'admin_email_mismatch',
        'Esta conta não é a identidade administrativa autorizada.',
      )
    }

    const { data, error } = await supabase.rpc('api_admin_bootstrap', {
      p_user_id: userId,
    })
    if (error) {
      if (String(error.message).includes('admin_exists')) {
        throw new HttpError(409, 'admin_exists', 'Já existe um superadmin provisionado.')
      }
      if (String(error.message).includes('admin_revoked')) {
        throw new HttpError(403, 'admin_revoked', 'A identidade administrativa foi revogada.')
      }
      throw new HttpError(500, 'admin_bootstrap_failed')
    }

    const row = Array.isArray(data) ? data[0] : data
    const { error: auditError } = await supabase.from('platform_audit_events').insert({
      actor_user_id: userId,
      action: 'admin.bootstrap',
      status: 'ok',
      metadata: { singleton: true },
    })
    if (auditError) logError('admin_bootstrap_audit', auditError)

    return jsonResponse(
      req,
      {
        bootstrapped: true,
        user_id: row?.user_id ?? userId,
        created_at: row?.created_at ?? null,
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
