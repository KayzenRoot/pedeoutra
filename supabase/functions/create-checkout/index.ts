import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier , assertRole} from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  readOptionalJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { AsaasClient, AsaasError, asaasConfigFromEnv } from '../_shared/asaas.ts'
import {
  isPlanCode,
  planAvailability,
  type PlanCatalogRow,
  type PlanCode,
} from '../_shared/plans.ts'

interface ExistingSubscription {
  id: string
  state: string
  plan_code: string
  current_period_end: string | null
  provider_customer_id: string | null
  last_provider_event_at: string | null
}

async function loadPlan(
  supabase: SupabaseClient,
  planCode: PlanCode,
): Promise<PlanCatalogRow> {
  const availability = planAvailability(planCode, (name) => Deno.env.get(name))
  if (!availability.available) {
    throw new HttpError(
      409,
      'plan_not_available',
      'O plano Profissional ainda não está disponível para contratação.',
      { reason: availability.reason },
    )
  }

  const { data, error } = await supabase
    .from('plan_catalog')
    .select('plan_code, plan_version, price_cents, currency, trial_days, active, effective_from')
    .eq('plan_code', planCode)
    .eq('active', true)
    .order('plan_version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new HttpError(500, 'plan_lookup_failed')
  if (!data) throw new HttpError(409, 'plan_not_available', 'Plano indisponível.')

  const plan = data as PlanCatalogRow
  if (plan.currency !== 'BRL' || plan.price_cents <= 0) {
    throw new HttpError(503, 'plan_catalog_invalid')
  }
  return plan
}

async function getExistingSubscription(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ExistingSubscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw new HttpError(500, 'subscription_lookup_failed')
  return (data as ExistingSubscription | null) ?? null
}

function periodIsActive(subscription: ExistingSubscription): boolean {
  return (
    subscription.current_period_end !== null &&
    new Date(subscription.current_period_end).getTime() > Date.now()
  )
}

function assertCanCheckout(
  existing: ExistingSubscription | null,
  planCode: PlanCode,
): void {
  if (!existing) return
  if (!['active', 'past_due', 'canceled'].includes(existing.state)) return
  if (existing.current_period_end !== null && !periodIsActive(existing)) return

  if (existing.plan_code === planCode) {
    throw new HttpError(409, 'already_active', 'Sua assinatura já está ativa.')
  }
  throw new HttpError(
    409,
    'plan_change_requires_support',
    'A troca de plano exige atendimento para evitar cobrança duplicada.',
  )
}

async function savePendingCheckout(
  supabase: SupabaseClient,
  organizationId: string,
  existing: ExistingSubscription | null,
  plan: PlanCatalogRow,
  checkoutId: string,
): Promise<void> {
  const { error } = await supabase.from('subscriptions').upsert(
    {
      organization_id: organizationId,
      provider: 'asaas',
      provider_checkout_id: checkoutId,
      provider_subscription_id: null,
      provider_customer_id: existing?.provider_customer_id ?? null,
      state: 'pending',
      current_period_end: null,
      plan_code: plan.plan_code,
      plan_version: plan.plan_version,
      pending_plan_code: null,
      pending_plan_version: null,
      pending_plan_effective_at: null,
      pending_provider_checkout_id: null,
      last_verified_at: new Date().toISOString(),
      last_provider_event_at: existing?.last_provider_event_at ?? null,
    },
    { onConflict: 'organization_id' },
  )
  if (error) throw new HttpError(500, 'subscription_save_failed')
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'create-checkout', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner'])
    await enforceRateLimit(supabase, `checkout:${organization.id}`, 5, 3600)

    const body = await readOptionalJson(req)
    const requestedPlan = body.plan_code ?? 'essential'
    if (!isPlanCode(requestedPlan)) {
      throw new HttpError(400, 'invalid_plan', 'Plano inválido.')
    }

    const plan = await loadPlan(supabase, requestedPlan)
    const config = asaasConfigFromEnv((name) => Deno.env.get(name))
    if (!config) {
      throw new HttpError(
        503,
        'billing_not_configured',
        'Cobrança em produção ainda não configurada (PROD BLOCKED). Use o sandbox autorizado.',
      )
    }

    const existing = await getExistingSubscription(supabase, organization.id)
    assertCanCheckout(existing, requestedPlan)

    const client = new AsaasClient(config)
    let checkout
    try {
      checkout = await client.createRecurringCheckout({
        organizationId: organization.id,
        planCode: requestedPlan,
        priceCents: plan.price_cents,
      })
    } catch (error) {
      logError('create_checkout', error, { organization_id: organization.id })
      if (error instanceof AsaasError) {
        throw new HttpError(
          502,
          'billing_provider_error',
          'O provedor de pagamento não respondeu como esperado. Tente novamente.',
        )
      }
      throw error
    }

    await savePendingCheckout(supabase, organization.id, existing, plan, checkout.id)

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'billing.checkout_created',
      entity: 'subscription',
      entityId: existing?.id ?? null,
      metadata: {
        provider_checkout_id: checkout.id,
        plan_code: plan.plan_code,
        plan_version: plan.plan_version,
      },
    })

    return jsonResponse(
      req,
      {
        checkout_url: checkout.link,
        checkout_id: checkout.id,
        plan_code: plan.plan_code,
        plan_version: plan.plan_version,
        price_cents: plan.price_cents,
        currency: plan.currency,
        cycle: 'MONTHLY',
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
