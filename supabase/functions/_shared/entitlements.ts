import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { HttpError } from './http.ts'

export interface EffectivePlan {
  plan_code: string
  plan_version: number
  access_kind: string
  access_until: string | null
}

export async function effectivePlan(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<EffectivePlan | null> {
  const { data, error } = await supabase.rpc('api_effective_plan', {
    p_organization_id: organizationId,
  })
  if (error) throw new HttpError(503, 'entitlement_check_failed')
  const row = Array.isArray(data) ? data[0] : data
  return (row as EffectivePlan | undefined) ?? null
}

export async function hasEntitlement(
  supabase: SupabaseClient,
  organizationId: string,
  featureKey: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('api_assert_entitlement', {
    p_organization_id: organizationId,
    p_feature_key: featureKey,
  })
  if (error) throw new HttpError(503, 'entitlement_check_failed')
  return data === true
}

/** Guard server-side para features premium; UI flag não substitui. */
export async function assertEntitlement(
  supabase: SupabaseClient,
  organizationId: string,
  featureKey: string,
): Promise<void> {
  if (await hasEntitlement(supabase, organizationId, featureKey)) return
  throw new HttpError(
    403,
    'plan_required',
    'Esta funcionalidade exige o plano Profissional ativo.',
    { feature: featureKey },
  )
}

export async function consumeQuota(
  supabase: SupabaseClient,
  organizationId: string,
  quotaKey: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('api_consume_quota', {
    p_organization_id: organizationId,
    p_quota_key: quotaKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) throw new HttpError(503, 'quota_check_failed')
  return data === true
}
