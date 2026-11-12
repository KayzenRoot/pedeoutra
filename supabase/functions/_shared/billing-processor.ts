import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { AsaasError, type AsaasClient } from './asaas.ts'
import {
  asaasDateToPeriodEnd,
  decideBillingTransition,
  validateBillingEvent,
  type BillingEventData,
  type SubscriptionSnapshot,
  type VerifiedProviderState,
} from './billing.ts'
import type { SubscriptionState } from './access.ts'
import { auditEvent } from './audit.ts'
import { isUuid } from './validation.ts'
import { parseStoredEvent } from './billing-event.ts'
import { logError } from './http.ts'

function mergeVerified(
  current: VerifiedProviderState | null,
  next: VerifiedProviderState,
): VerifiedProviderState {
  return { ...(current ?? {}), ...next }
}

interface SubscriptionRow {
  id: string
  organization_id: string
  provider_subscription_id: string | null
  provider_checkout_id: string | null
  provider_customer_id: string | null
  state: SubscriptionState
  current_period_end: string | null
  last_provider_event_at: string | null
}

async function findSubscriptionRow(
  supabase: SupabaseClient,
  event: BillingEventData,
  verified: VerifiedProviderState | null,
): Promise<SubscriptionRow | null> {
  const byColumn = async (column: string, value: string | null) => {
    if (!value) return null
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq(column, value)
      .maybeSingle()
    if (error) throw new Error('subscription_lookup_failed')
    return (data as SubscriptionRow | null) ?? null
  }

  const attempts: Array<[string, string | null]> = [
    ['provider_subscription_id', event.subscriptionId],
    ['provider_checkout_id', event.checkoutId],
    ['provider_customer_id', event.customerId],
    ['organization_id', isUuid(event.externalReference) ? event.externalReference : null],
    ['provider_subscription_id', verified?.subscriptionId ?? null],
    ['provider_checkout_id', verified?.checkoutId ?? null],
    ['provider_customer_id', verified?.customerId ?? null],
  ]

  for (const [column, value] of attempts) {
    const row = await byColumn(column, value)
    if (row) return row
  }
  return null
}

async function verifyWithProvider(
  client: AsaasClient | null,
  event: BillingEventData,
): Promise<VerifiedProviderState | null> {
  if (!client) return null

  let verified: VerifiedProviderState | null = null

  if (event.subscriptionId) {
    try {
      verified = mergeVerified(verified, await client.getSubscription(event.subscriptionId))
    } catch (error) {
      if (event.type !== 'CHECKOUT_PAID') throw error
    }
  }

  if (event.paymentId) {
    verified = mergeVerified(verified, await client.getPayment(event.paymentId))
  }

  return verified
}

async function correlateSubscription(
  supabase: SupabaseClient,
  subscription: SubscriptionRow,
  event: BillingEventData,
  verified: VerifiedProviderState | null,
): Promise<void> {
  const updates: Record<string, string> = {}
  const subscriptionId =
    subscription.provider_subscription_id ?? event.subscriptionId ?? verified?.subscriptionId
  const customerId =
    subscription.provider_customer_id ?? event.customerId ?? verified?.customerId
  const checkoutId =
    subscription.provider_checkout_id ?? event.checkoutId ?? verified?.checkoutId

  if (!subscription.provider_subscription_id && subscriptionId) {
    updates.provider_subscription_id = subscriptionId
  }
  if (!subscription.provider_customer_id && customerId) {
    updates.provider_customer_id = customerId
  }
  if (!subscription.provider_checkout_id && checkoutId) {
    updates.provider_checkout_id = checkoutId
  }

  if (Object.keys(updates).length === 0) return

  const { error } = await supabase
    .from('subscriptions')
    .update(updates)
    .eq('id', subscription.id)
  if (error) throw new Error('subscription_correlation_failed')
  Object.assign(subscription, updates)
}

function safeFailureReason(error: unknown): string {
  if (error instanceof AsaasError) return `provider_${error.safeDetail}`.slice(0, 200)
  return 'processing_error'
}

export async function processBillingEventById(
  supabase: SupabaseClient,
  eventId: string,
  client: AsaasClient | null,
): Promise<'processed' | 'ignored' | 'failed' | 'skipped'> {
  const { data: rawEvent, error: eventError } = await supabase
    .from('billing_events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) throw new Error('billing_event_lookup_failed')
  if (!rawEvent) return 'failed'
  if (rawEvent.state === 'processed' || rawEvent.state === 'ignored') return 'skipped'

  const event = parseStoredEvent(rawEvent.payload_minimal)
  if (!event) {
    await supabase.rpc('api_mark_billing_event', {
      p_event_id: eventId,
      p_state: 'failed',
      p_error: 'invalid_stored_event',
    })
    return 'failed'
  }

  try {
    let verified = await verifyWithProvider(client, event)

    // A API do Asaas não expõe GET de checkout (404). O próprio evento
    // CHECKOUT_PAID, autenticado pelo token do webhook, é a evidência de
    // status/valor; a assinatura é confirmada por getSubscription abaixo.
    if (event.type === 'CHECKOUT_PAID' && !verified) {
      verified = {
        checkoutStatus: event.status,
        checkoutId: event.checkoutId,
        externalReference: event.externalReference,
        valueCents: event.valueCents,
      }
    }

    const subscription = await findSubscriptionRow(supabase, event, verified)
    if (!subscription) {
      await supabase.rpc('api_mark_billing_event', {
        p_event_id: eventId,
        p_state: 'failed',
        p_error: 'unmapped_tenant',
      })
      return 'failed'
    }

    await correlateSubscription(supabase, subscription, event, verified)

    if (event.type === 'CHECKOUT_PAID' && client && subscription.provider_subscription_id) {
      const providerSubscription = await client.getSubscription(
        subscription.provider_subscription_id,
      )
      verified = mergeVerified(verified, providerSubscription)
    }

    const requiresVerification = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(
      event.type,
    )
    if (requiresVerification && !verified) {
      await supabase.rpc('api_mark_billing_event', {
        p_event_id: eventId,
        p_state: 'failed',
        p_error: 'provider_unavailable',
      })
      return 'failed'
    }

    const validation = validateBillingEvent(event, subscription.organization_id, verified)
    if (!validation.ok) {
      await supabase.rpc('api_mark_billing_event', {
        p_event_id: eventId,
        p_state: 'failed',
        p_error: validation.reason,
      })
      return 'failed'
    }

    const snapshot: SubscriptionSnapshot = {
      state: subscription.state,
      currentPeriodEnd: subscription.current_period_end,
      providerSubscriptionId: subscription.provider_subscription_id,
      providerCheckoutId: subscription.provider_checkout_id,
      providerCustomerId: subscription.provider_customer_id,
      lastProviderEventAt: subscription.last_provider_event_at,
    }

    const decision = decideBillingTransition(snapshot, event, verified)

    if (decision.kind === 'ignore') {
      await supabase.rpc('api_mark_billing_event', {
        p_event_id: eventId,
        p_state: 'ignored',
        p_error: decision.reason,
      })
      return 'ignored'
    }

    if (decision.kind === 'reject' || decision.kind === 'verify') {
      await supabase.rpc('api_mark_billing_event', {
        p_event_id: eventId,
        p_state: 'failed',
        p_error: decision.reason,
      })
      return 'failed'
    }

    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        state: decision.state,
        current_period_end: decision.currentPeriodEnd,
        provider_subscription_id: decision.providerSubscriptionId,
        provider_checkout_id: decision.providerCheckoutId,
        provider_customer_id: decision.providerCustomerId,
        last_provider_event_at: decision.lastProviderEventAt,
        last_verified_at: new Date().toISOString(),
      })
      .eq('id', subscription.id)

    if (updateError) throw new Error('subscription_update_failed')

    await auditEvent(supabase, {
      organizationId: subscription.organization_id,
      actorUserId: null,
      action: 'billing.event_processed',
      entity: 'subscription',
      entityId: subscription.id,
      metadata: {
        event_type: event.type,
        state: decision.state,
        provider_event_id: event.id,
      },
    })

    await supabase.rpc('api_mark_billing_event', {
      p_event_id: eventId,
      p_state: 'processed',
      p_error: null,
    })
    return 'processed'
  } catch (error) {
    logError('billing_process', error, { event_type: event.type })
    await supabase.rpc('api_mark_billing_event', {
      p_event_id: eventId,
      p_state: 'failed',
      p_error: safeFailureReason(error),
    })
    return 'failed'
  }
}

export async function reconcileProviderSubscriptions(
  supabase: SupabaseClient,
  client: AsaasClient,
  limit = 20,
): Promise<{ checked: number; updated: number; failed: number }> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, provider_subscription_id, state, current_period_end, organization_id')
    .in('state', ['active', 'past_due'])
    .not('provider_subscription_id', 'is', null)
    .limit(limit)

  if (error) throw new Error('subscription_reconcile_lookup_failed')

  let checked = 0
  let updated = 0
  let failed = 0

  for (const row of data ?? []) {
    checked += 1
    try {
      const provider = await client.getSubscription(row.provider_subscription_id as string)
      const status = (provider.subscriptionStatus ?? '').toUpperCase()
      const nextState =
        status === 'INACTIVE' || status === 'DELETED'
          ? ('canceled' as SubscriptionState)
          : null
      const periodEnd = provider.nextDueDate
        ? asaasDateToPeriodEnd(provider.nextDueDate) ?? row.current_period_end
        : row.current_period_end

      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({
          state: nextState ?? row.state,
          current_period_end: nextState ? row.current_period_end : periodEnd,
          last_verified_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      if (updateError) throw new Error('subscription_reconcile_update_failed')
      if (nextState || periodEnd !== row.current_period_end) updated += 1
    } catch (error) {
      failed += 1
      logError('billing_reconcile', error, { subscription_id: row.id })
    }
  }

  return { checked, updated, failed }
}
