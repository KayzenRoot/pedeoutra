import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import {
  AsaasClient,
  AsaasError,
  asaasConfigFromEnv,
} from '../_shared/asaas.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'create-checkout', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await enforceRateLimit(supabase, `checkout:${organization.id}`, 5, 3600)

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

    if (
      existing?.state === 'active' &&
      (!existing.current_period_end ||
        new Date(existing.current_period_end).getTime() > Date.now())
    ) {
      throw new HttpError(409, 'already_active', 'Sua assinatura já está ativa.')
    }

    const client = new AsaasClient(config)
    let checkout
    try {
      checkout = await client.createRecurringCheckout({
        organizationId: organization.id,
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
      metadata: { provider_checkout_id: checkout.id },
    })

    return jsonResponse(
      req,
      {
        checkout_url: checkout.link,
        checkout_id: checkout.id,
        price_cents: 2990,
        cycle: 'MONTHLY',
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
