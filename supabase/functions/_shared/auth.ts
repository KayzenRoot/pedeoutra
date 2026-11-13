import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { getBearerToken, HttpError } from './http.ts'

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

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('id, owner_user_id, name, slug, whatsapp, city, trial_ends_at, access_state')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()

  if (orgError) throw new HttpError(500, 'organization_lookup_failed')
  if (!organization) {
    throw new HttpError(409, 'organization_required', 'Crie sua organização antes de continuar.')
  }

  return {
    user: { id: data.user.id, email: data.user.email ?? '' },
    organization: organization as OrganizationRow,
  }
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
