import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { getBearerToken, HttpError } from './http.ts'

export interface JwtClaims {
  sub?: string
  aal?: string
  amr?: unknown
  [key: string]: unknown
}

export interface AuthenticatedContext {
  userId: string
  email: string
  token: string
  claims: JwtClaims
}

export interface PlatformAdminContext extends AuthenticatedContext {}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return atob(padded)
}

export function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split('.')
  if (parts.length !== 3) throw new HttpError(401, 'unauthorized', 'Sessão inválida.')
  try {
    const parsed = JSON.parse(base64UrlDecode(parts[1])) as unknown
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid_claims')
    return parsed as JwtClaims
  } catch {
    throw new HttpError(401, 'unauthorized', 'Sessão inválida.')
  }
}

function amrMethods(amr: unknown): string[] {
  if (!Array.isArray(amr)) return []
  return amr
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'method' in item) {
        return String((item as { method: unknown }).method)
      }
      return ''
    })
    .filter(Boolean)
}

/** AAL2 com TOTP verificado no token assinado pelo Supabase. */
export function isAal2Totp(claims: JwtClaims): boolean {
  return claims.aal === 'aal2' && amrMethods(claims.amr).includes('totp')
}

export async function requireAuthenticatedClaims(
  req: Request,
  supabase: SupabaseClient,
): Promise<AuthenticatedContext> {
  const token = getBearerToken(req)
  if (!token) throw new HttpError(401, 'unauthorized', 'Sessão ausente.')

  const claims = decodeJwtClaims(token)
  if (!isAal2Totp(claims)) {
    throw new HttpError(403, 'mfa_required', 'Confirme o MFA TOTP (AAL2) para continuar.')
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    throw new HttpError(401, 'unauthorized', 'Sessão inválida ou expirada.')
  }
  if (claims.sub && claims.sub !== data.user.id) {
    throw new HttpError(401, 'unauthorized', 'Sessão inválida.')
  }

  return {
    userId: data.user.id,
    email: (data.user.email ?? '').trim().toLowerCase(),
    token,
    claims,
  }
}

export async function requirePlatformAdmin(
  req: Request,
  supabase: SupabaseClient,
): Promise<PlatformAdminContext> {
  const { userId, email, token, claims } = await requireAuthenticatedClaims(req, supabase)

  const { data, error } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) throw new HttpError(503, 'admin_lookup_failed')
  if (!data) {
    throw new HttpError(
      403,
      'admin_forbidden',
      'Acesso administrativo indisponível para esta conta.',
    )
  }

  return { userId, email, token, claims }
}
