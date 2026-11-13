import { adminClient } from '../_shared/supabase.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  withHttpErrors,
} from '../_shared/http.ts'
import { PLAN_CODES, planAvailability, type PlanCode } from '../_shared/plans.ts'

interface CatalogRow {
  plan_code: PlanCode
  plan_version: number
  price_cents: number
  currency: string
  trial_days: number
}

interface FeatureRow {
  plan_code: string
  plan_version: number
  feature_key: string
  enabled: boolean
  limit_value: number | null
  limit_window: string | null
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'plan-catalog', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'plan-catalog'), 60, 60)

    const { data: plans, error: planError } = await supabase
      .from('plan_catalog')
      .select('plan_code, plan_version, price_cents, currency, trial_days')
      .eq('active', true)
      .in('plan_code', [...PLAN_CODES])
      .order('plan_version', { ascending: false })
    if (planError) throw new Error('plan_catalog_lookup_failed')

    const latest = new Map<string, CatalogRow>()
    for (const row of (plans ?? []) as CatalogRow[]) {
      if (!latest.has(row.plan_code)) latest.set(row.plan_code, row)
    }

    const versions = [...latest.values()]
    const { data: features, error: featureError } = versions.length
      ? await supabase
          .from('plan_feature_entitlements')
          .select('plan_code, plan_version, feature_key, enabled, limit_value, limit_window')
          .in('plan_code', versions.map((plan) => plan.plan_code))
      : { data: [], error: null }
    if (featureError) throw new Error('plan_features_lookup_failed')

    const featureRows = (features ?? []) as FeatureRow[]

    return jsonResponse(req, {
      plans: versions.map((plan) => {
        const availability = planAvailability(plan.plan_code, (name) => Deno.env.get(name))
        return {
          plan_code: plan.plan_code,
          plan_version: plan.plan_version,
          price_cents: plan.price_cents,
          currency: plan.currency,
          trial_days: plan.trial_days,
          available: availability.available,
          unavailable_reason: availability.reason,
          features: featureRows
            .filter(
              (feature) =>
                feature.plan_code === plan.plan_code &&
                feature.plan_version === plan.plan_version,
            )
            .map((feature) => ({
              key: feature.feature_key,
              enabled: feature.enabled,
              limit_value: feature.limit_value,
              limit_window: feature.limit_window,
            })),
        }
      }),
    })
  })

if (import.meta.main) Deno.serve(handler)
