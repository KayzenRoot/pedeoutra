/**
 * Máquina de estados de billing (pura, testável em Node).
 *
 * Regras não negociáveis:
 * - successUrl nunca ativa acesso;
 * - somente evento de pagamento validado (valor, tenant e estado do provedor);
 * - evento duplicado não muda estado; evento antigo não reativa;
 * - reembolso sempre revoga;
 * - evento ambíguo retorna "verify" e não altera o banco.
 */
import type { SubscriptionState } from './access.ts'

export const PLAN_PRICE_CENTS = 2990
export const PLAN_CURRENCY = 'BRL'
export const BILLING_PROVIDER = 'asaas'
export const SUBSCRIPTION_CYCLE = 'MONTHLY'

const DAY_MS = 24 * 60 * 60 * 1000
const FALLBACK_PERIOD_DAYS = 30

export interface BillingEventData {
  id: string
  type: string
  dateCreated: string | null
  checkoutId: string | null
  subscriptionId: string | null
  paymentId: string | null
  customerId: string | null
  externalReference: string | null
  valueCents: number | null
  status: string | null
  dueDate: string | null
  nextDueDate: string | null
}

export interface VerifiedProviderState {
  checkoutId?: string | null
  checkoutStatus?: string | null
  subscriptionId?: string | null
  subscriptionStatus?: string | null
  paymentStatus?: string | null
  nextDueDate?: string | null
  externalReference?: string | null
  valueCents?: number | null
}

export interface SubscriptionSnapshot {
  state: SubscriptionState
  currentPeriodEnd: string | null
  providerSubscriptionId: string | null
  providerCheckoutId: string | null
  providerCustomerId: string | null
  lastProviderEventAt: string | null
}

export type BillingDecision =
  | {
      kind: 'apply'
      state: SubscriptionState
      currentPeriodEnd: string | null
      providerSubscriptionId: string | null
      providerCheckoutId: string | null
      providerCustomerId: string | null
      lastProviderEventAt: string
      reason: string
    }
  | { kind: 'ignore'; reason: string }
  | { kind: 'reject'; reason: string }
  | { kind: 'verify'; reason: string }

export type BillingValidation =
  | { ok: true }
  | { ok: false; reason: 'tenant_mismatch' | 'amount_mismatch' | 'amount_unverified' }

export function toCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric * 100)
}

export function parseAsaasInstant(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00-03:00`)
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed.replace(' ', 'T')}-03:00`)
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function asaasDateToPeriodEnd(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T23:59:59-03:00`).toISOString()
  }
  const parsed = parseAsaasInstant(trimmed)
  return parsed ? parsed.toISOString() : null
}

function fallbackPeriodEnd(now: Date): string {
  return new Date(now.getTime() + FALLBACK_PERIOD_DAYS * DAY_MS).toISOString()
}

function eventInstant(event: BillingEventData, now: Date): Date {
  return parseAsaasInstant(event.dateCreated) ?? now
}

function lastEventInstant(snapshot: SubscriptionSnapshot): Date | null {
  return parseAsaasInstant(snapshot.lastProviderEventAt)
}

function normalizedStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

function isPaidStatus(value: string | null | undefined): boolean {
  return ['PAID', 'RECEIVED', 'CONFIRMED'].includes(normalizedStatus(value))
}

function isInactiveStatus(value: string | null | undefined): boolean {
  return ['INACTIVE', 'DELETED', 'CANCELED', 'CANCELLED', 'EXPIRED'].includes(
    normalizedStatus(value),
  )
}

function isPaymentEvent(type: string): boolean {
  return ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED'].includes(type)
}

export function validateBillingEvent(
  event: BillingEventData,
  organizationId: string,
  verified: VerifiedProviderState | null,
): BillingValidation {
  if (event.externalReference && event.externalReference !== organizationId) {
    return { ok: false, reason: 'tenant_mismatch' }
  }
  if (verified?.externalReference && verified.externalReference !== organizationId) {
    return { ok: false, reason: 'tenant_mismatch' }
  }

  if (isPaymentEvent(event.type) || event.type === 'CHECKOUT_PAID') {
    const amount = verified?.valueCents ?? event.valueCents
    if (amount === null) return { ok: false, reason: 'amount_unverified' }
    if (amount !== PLAN_PRICE_CENTS) return { ok: false, reason: 'amount_mismatch' }
  } else if (event.valueCents !== null && event.valueCents !== PLAN_PRICE_CENTS) {
    return { ok: false, reason: 'amount_mismatch' }
  }

  return { ok: true }
}

function apply(
  snapshot: SubscriptionSnapshot,
  event: BillingEventData,
  now: Date,
  state: SubscriptionState,
  currentPeriodEnd: string | null,
  reason: string,
): BillingDecision {
  return {
    kind: 'apply',
    state,
    currentPeriodEnd,
    providerSubscriptionId: event.subscriptionId ?? snapshot.providerSubscriptionId,
    providerCheckoutId: event.checkoutId ?? snapshot.providerCheckoutId,
    providerCustomerId: event.customerId ?? snapshot.providerCustomerId,
    lastProviderEventAt: eventInstant(event, now).toISOString(),
    reason,
  }
}

export function decideBillingTransition(
  snapshot: SubscriptionSnapshot,
  event: BillingEventData,
  verified: VerifiedProviderState | null,
  now: Date = new Date(),
): BillingDecision {
  const eventAt = eventInstant(event, now)
  const lastAt = lastEventInstant(snapshot)
  const isRefund =
    event.type === 'PAYMENT_REFUNDED' ||
    normalizedStatus(verified?.paymentStatus) === 'REFUNDED'

  // Reembolso é terminal e sempre prevalece, mesmo fora de ordem.
  if (isRefund) {
    return apply(snapshot, event, now, 'refunded', null, 'payment_refunded')
  }

  if (lastAt && eventAt.getTime() < lastAt.getTime()) {
    return { kind: 'ignore', reason: 'stale_event' }
  }

  const subscriptionId = verified?.subscriptionId ?? event.subscriptionId

  switch (event.type) {
    case 'CHECKOUT_PAID': {
      if (!verified) return { kind: 'verify', reason: 'checkout_not_verified' }
      // "ACTIVE" de assinatura não é evidência de pagamento; exige checkout
      // PAID ou pagamento RECEIVED/CONFIRMED confirmado pelo provedor.
      const paid =
        isPaidStatus(verified.checkoutStatus) || isPaidStatus(verified.paymentStatus)
      if (!paid) return { kind: 'verify', reason: 'checkout_not_paid' }
      if (snapshot.state === 'refunded') {
        return { kind: 'ignore', reason: 'refunded_is_terminal' }
      }
      if (!subscriptionId) return { kind: 'verify', reason: 'subscription_not_found' }

      const periodEnd =
        asaasDateToPeriodEnd(verified?.nextDueDate ?? event.nextDueDate ?? event.dueDate) ??
        fallbackPeriodEnd(now)

      return apply(snapshot, event, now, 'active', periodEnd, 'checkout_paid_verified')
    }

    case 'SUBSCRIPTION_CREATED': {
      if (verified && isInactiveStatus(verified.subscriptionStatus)) {
        return { kind: 'ignore', reason: 'subscription_inactive' }
      }
      const nextState: SubscriptionState = snapshot.state === 'active' ? 'active' : 'pending'
      return apply(
        snapshot,
        event,
        now,
        nextState,
        snapshot.currentPeriodEnd,
        'subscription_created',
      )
    }

    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED': {
      if (!verified) return { kind: 'verify', reason: 'payment_not_verified' }
      if (!isPaidStatus(verified.paymentStatus ?? event.status)) {
        return { kind: 'verify', reason: 'payment_not_confirmed' }
      }
      if (!subscriptionId) return { kind: 'verify', reason: 'subscription_not_found' }
      if (snapshot.state === 'refunded') {
        return { kind: 'ignore', reason: 'refunded_is_terminal' }
      }
      if (snapshot.state === 'canceled' || snapshot.state === 'expired') {
        return { kind: 'ignore', reason: 'payment_after_cancellation' }
      }

      const periodEnd =
        asaasDateToPeriodEnd(verified?.nextDueDate ?? event.nextDueDate ?? event.dueDate) ??
        fallbackPeriodEnd(now)

      return apply(snapshot, event, now, 'active', periodEnd, 'payment_confirmed')
    }

    case 'PAYMENT_OVERDUE': {
      if (snapshot.state === 'refunded') return { kind: 'ignore', reason: 'refunded_is_terminal' }
      if (snapshot.state === 'canceled' || snapshot.state === 'expired') {
        return { kind: 'ignore', reason: 'inactive_subscription' }
      }
      return apply(
        snapshot,
        event,
        now,
        'past_due',
        snapshot.currentPeriodEnd,
        'payment_overdue',
      )
    }

    case 'SUBSCRIPTION_DELETED':
    case 'SUBSCRIPTION_INACTIVATED': {
      if (snapshot.state === 'refunded') {
        return { kind: 'ignore', reason: 'refunded_is_terminal' }
      }
      return apply(
        snapshot,
        event,
        now,
        'canceled',
        snapshot.currentPeriodEnd,
        'subscription_canceled',
      )
    }

    case 'CHECKOUT_EXPIRED':
    case 'CHECKOUT_CANCELED': {
      if (snapshot.state === 'pending' && !snapshot.providerSubscriptionId) {
        return apply(snapshot, event, now, 'expired', null, 'checkout_expired')
      }
      return { kind: 'ignore', reason: 'non_pending_checkout' }
    }

    default:
      return { kind: 'ignore', reason: 'unknown_event' }
  }
}
