import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier } from '../_shared/auth.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import { AsaasClient, AsaasError, asaasConfigFromEnv } from '../_shared/asaas.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'cancel-subscription', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)

    const config = asaasConfigFromEnv((name) => Deno.env.get(name))
    if (!config) {
      throw new HttpError(
        503,
        'billing_not_configured',
        'Cobrança em produção ainda não configurada (PROD BLOCKED).',
      )
    }

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('organization_id', organization.id)
      .maybeSingle()

    if (error) throw new HttpError(500, 'subscription_lookup_failed')
    if (!subscription?.provider_subscription_id) {
      throw new HttpError(409, 'no_active_subscription', 'Não há assinatura ativa para cancelar.')
    }
    if (!['active', 'past_due'].includes(subscription.state)) {
      throw new HttpError(409, 'no_active_subscription', 'A assinatura não está ativa.')
    }

    const client = new AsaasClient(config)
    try {
      await client.cancelSubscription(subscription.provider_subscription_id)
    } catch (error) {
      logError('cancel_subscription', error, { organization_id: organization.id })
      if (error instanceof AsaasError) {
        throw new HttpError(
          502,
          'billing_provider_error',
          'O provedor de pagamento não confirmou o cancelamento. Tente novamente.',
        )
      }
      throw error
    }

    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        state: 'canceled',
        last_verified_at: new Date().toISOString(),
        pending_plan_code: null,
        pending_plan_version: null,
        pending_plan_effective_at: null,
        pending_provider_checkout_id: null,
      })
      .eq('organization_id', organization.id)

    if (updateError) throw new HttpError(500, 'subscription_update_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'billing.subscription_canceled',
      entity: 'subscription',
      entityId: subscription.id,
    })

    return jsonResponse(req, {
      state: 'canceled',
      access_until: subscription.current_period_end,
    })
  })

if (import.meta.main) Deno.serve(handler)
