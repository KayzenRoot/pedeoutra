import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier } from '../_shared/auth.ts'
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
import { isPlanCode, planAvailability, type PlanCatalogRow } from '../_shared/plans.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'create-checkout', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await enforceRateLimit(supabase, `checkout:${organization.id}`, 5, 3600)

    const body = await readOptionalJson(req)
    const requestedPlan = body.plan_code ?? 'essential'
    if (!isPlanCode(requestedPlan)) {
      throw new HttpError(400, 'invalid_plan', 'Plano inválido.')
    }

    const availability = planAvailability(requestedPlan, (name) => Deno.env.get(name))
    if (!availability.available) {
      throw new HttpError(
        409,
        'plan_not_available',
        'O plano Profissional ainda não está disponível para contratação.',
        { reason: availability.reason },
      )
    }

    const { data: plan, error: planError } = await supabase
      .from('plan_catalog')
      .select('plan_code, plan_version, price_cents, currency, trial_days, active, effective_from')
      .eq('plan_code', requestedPlan)
      .eq('active', true)
      .order('plan_version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (planError) throw new HttpError(500, 'plan_lookup_failed')
    if (!plan) throw new HttpError(409, 'plan_not_available', 'Plano indisponível.')

    const catalog = plan as PlanCatalogRow
    if (catalog.currency !== 'BRL' || catalog.price_cents <= 0) {
      throw new HttpError(503, 'plan_catalog_invalid')
    }

    const config = asaasConfigFromEnv((name) => Deno.env.get(name))
    if (!config) {
      throw new HttpError(
        503,
        'billing_not_configured',
        'Cobrança em produção ainda não configurada (PROD BLOCKED). Use o sandbox autorizado.',
      )
    }

    const { data: existing, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('organization_id', organization.id)
      .maybeSingle()

    if (subscriptionError) throw new HttpError(500, 'subscription_lookup_failed')

    const periodActive =
      existing?.current_period_end &&
      new Date(existing.current_period_end).getTime() > Date.now()
    if (
      existing &&
      ['active', 'past_due', 'canceled'].includes(existing.state) &&
      (existing.current_period_end === null || periodActive)
    ) {
      if (existing.plan_code === requestedPlan) {
        throw new HttpError(409, 'already_active', 'Sua assinatura já está ativa.')
      }
      throw new HttpError(
        409,
        'plan_change_requires_support',
        'A troca de plano exige atendimento para evitar cobrança duplicada.',
      )
    }

    const client = new AsaasClient(config)
    let checkout
    try {
      checkout = await client.createRecurringCheckout({
        organizationId: organization.id,
        planCode: requestedPlan,
        priceCents: catalog.price_cents,
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

    const { error: upsertError } = await supabase.from('subscriptions').upsert(
      {
        organization_id: organization.id,
        provider: 'asaas',
        provider_checkout_id: checkout.id,
        provider_subscription_id: null,
        provider_customer_id: existing?.provider_customer_id ?? null,
        state: 'pending',
        current_period_end: null,
        plan_code: catalog.plan_code,
        plan_version: catalog.plan_version,
        pending_plan_code: null,
        pending_plan_version: null,
        pending_plan_effective_at: null,
        pending_provider_checkout_id: null,
        last_verified_at: new Date().toISOString(),
        last_provider_event_at: existing?.last_provider_event_at ?? null,
      },
      { onConflict: 'organization_id' },
    )

    if (upsertError) throw new HttpError(500, 'subscription_save_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'billing.checkout_created',
      entity: 'subscription',
      entityId: existing?.id ?? null,
      metadata: {
        provider_checkout_id: checkout.id,
        plan_code: catalog.plan_code,
        plan_version: catalog.plan_version,
      },
    })

    return jsonResponse(
      req,
      {
        checkout_url: checkout.link,
        checkout_id: checkout.id,
        plan_code: catalog.plan_code,
        plan_version: catalog.plan_version,
        price_cents: catalog.price_cents,
        currency: catalog.currency,
        cycle: 'MONTHLY',
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
