import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { getBearerToken, HttpError } from './http.ts'
import { decodeJwtClaims, isAal2Totp } from './admin.ts'

export interface OrganizationRow {
  id: string
  owner_user_id: string
  name: string
  slug: string
  whatsapp: string
  city: string | null
  trial_ends_at: string
  access_state: string
}

export interface SupplierContext {
  user: { id: string; email: string }
  organization: OrganizationRow
  role: string
}

export async function requireSupplier(
  req: Request,
  supabase: SupabaseClient,
): Promise<SupplierContext> {
  const token = getBearerToken(req)
  if (!token) throw new HttpError(401, 'unauthorized', 'Sessão ausente.')

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    throw new HttpError(401, 'unauthorized', 'Sessão inválida ou expirada.')
  }

  const { data: membership, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('organization_id, role')
    .eq('user_id', data.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (membershipError) throw new HttpError(503, 'membership_lookup_failed')

  let organization: OrganizationRow | null = null
  let role = membership?.role ?? 'owner'
  if (membership?.organization_id) {
    const { data: orgData, error } = await supabase
      .from('organizations')
      .select('id, owner_user_id, name, slug, whatsapp, city, trial_ends_at, access_state')
      .eq('id', membership.organization_id)
      .maybeSingle()
    if (error) throw new HttpError(500, 'organization_lookup_failed')
    organization = (orgData as OrganizationRow | null) ?? null
  } else {
    const { data: orgData, error } = await supabase
      .from('organizations')
      .select('id, owner_user_id, name, slug, whatsapp, city, trial_ends_at, access_state')
      .eq('owner_user_id', data.user.id)
      .maybeSingle()
    if (error) throw new HttpError(500, 'organization_lookup_failed')
    organization = (orgData as OrganizationRow | null) ?? null
    role = 'owner'
  }

  if (!organization) {
    throw new HttpError(409, 'organization_required', 'Crie sua organização antes de continuar.')
  }

  return {
    user: { id: data.user.id, email: data.user.email ?? '' },
    organization,
    role,
  }
}

export function assertRole(role: string, allowed: string[]): void {
  if (allowed.includes(role)) return
  throw new HttpError(403, 'forbidden', 'Seu papel não permite esta operação.')
}

/** Exige AAL2/TOTP no JWT assinado; usado em operações de equipe. */
export function assertAal2(req: Request): void {
  const token = getBearerToken(req)
  if (!token) throw new HttpError(401, 'unauthorized', 'Sessão ausente.')
  const claims = decodeJwtClaims(token)
  if (!isAal2Totp(claims)) {
    throw new HttpError(403, 'mfa_required', 'Confirme o MFA TOTP (AAL2) para continuar.')
  }
}

export async function requireAuthenticatedUser(
  req: Request,
  supabase: SupabaseClient,
): Promise<{ id: string; email: string }> {
  const token = getBearerToken(req)
  if (!token) throw new HttpError(401, 'unauthorized', 'Sessão ausente.')
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    throw new HttpError(401, 'unauthorized', 'Sessão inválida ou expirada.')
  }
  return { id: data.user.id, email: (data.user.email ?? '').toLowerCase() }
}

export async function assertWriteAccess(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('api_org_can_write', {
    p_organization_id: organizationId,
  })
  if (error) throw new HttpError(503, 'access_check_failed')
  if (data !== true) {
    throw new HttpError(
      403,
      'subscription_inactive',
      'Teste expirado ou assinatura inativa. Regularize para continuar.',
    )
  }
}
