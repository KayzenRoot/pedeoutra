/**
 * Espelho em TypeScript de app.org_can_write (SQL).
 * A verdade final é sempre o banco; este helper serve para exibir estado e
 * decidir se o catálogo aceita pedidos antes da chamada transacional.
 */
export type SubscriptionState =
  | 'pending'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'refunded'

export interface SubscriptionAccess {
  state: string
  current_period_end: string | null
}

export interface OrgAccessInput {
  trial_ends_at: string
  access_state: string
  subscription?: SubscriptionAccess | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export function isWriteAllowed(input: OrgAccessInput, now: Date = new Date()): boolean {
  if (input.access_state === 'blocked') return false

  const trialEnd = Date.parse(input.trial_ends_at)
  if (Number.isFinite(trialEnd) && now.getTime() < trialEnd) return true

  const subscription = input.subscription
  if (!subscription) return false

  const periodEnd = subscription.current_period_end
    ? Date.parse(subscription.current_period_end)
    : null

  if (subscription.state === 'active') {
    return periodEnd === null || (Number.isFinite(periodEnd) && periodEnd > now.getTime())
  }
  if (subscription.state === 'past_due') {
    return periodEnd !== null && Number.isFinite(periodEnd) && now.getTime() < periodEnd + 3 * DAY_MS
  }
  if (subscription.state === 'canceled') {
    return periodEnd !== null && Number.isFinite(periodEnd) && now.getTime() < periodEnd
  }
  return false
}

export type AccessLabel =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'blocked'

export function accessLabel(input: OrgAccessInput, now: Date = new Date()): AccessLabel {
  if (input.access_state === 'blocked') return 'blocked'
  if (isWriteAllowed(input, now)) {
    if (input.subscription?.state === 'active') return 'active'
    if (input.subscription?.state === 'past_due') return 'past_due'
    if (input.subscription?.state === 'canceled') return 'canceled'
    return 'trial'
  }
  return 'expired'
}
