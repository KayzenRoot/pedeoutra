/**
 * Parsing puro de payloads Asaas. Sem dependência de Deno/Supabase para ser
 * testável em Node e reutilizado pelo processador de webhook.
 */
import { toCents, type BillingEventData } from './billing.ts'
import { isRecord } from './validation.ts'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function checkoutTotalCents(checkout: Record<string, unknown>): number | null {
  if (typeof checkout.value === 'number') return Math.round(checkout.value * 100)
  const items = Array.isArray(checkout.items) ? checkout.items : null
  if (!items || items.length === 0) return null

  let total = 0
  for (const item of items) {
    if (!isRecord(item)) return null
    const value = toCents(item.value)
    const quantity = Number(item.quantity ?? 1)
    if (value === null || !Number.isFinite(quantity) || quantity <= 0) return null
    total += value * Math.round(quantity)
  }
  return total > 0 ? total : null
}

export function parseAsaasEvent(payload: unknown): BillingEventData | null {
  if (!isRecord(payload)) return null

  const id = text(payload.id)
  const type = text(payload.event)
  if (!id || !type) return null

  const checkout = isRecord(payload.checkout) ? payload.checkout : null
  const subscription = isRecord(payload.subscription) ? payload.subscription : null
  const payment = isRecord(payload.payment) ? payload.payment : null
  const checkoutSubscription =
    checkout && isRecord(checkout.subscription) ? checkout.subscription : null

  return {
    id,
    type,
    dateCreated: text(payload.dateCreated),
    checkoutId: text(checkout?.id),
    subscriptionId:
      text(subscription?.id) ?? text(payment?.subscription) ?? text(checkoutSubscription?.id),
    paymentId: text(payment?.id),
    customerId:
      text(subscription?.customer) ?? text(payment?.customer) ?? text(checkout?.customer),
    externalReference:
      text(subscription?.externalReference) ??
      text(payment?.externalReference) ??
      text(checkout?.externalReference),
    valueCents:
      toCents(payment?.value) ??
      toCents(subscription?.value) ??
      (checkout ? checkoutTotalCents(checkout) : null),
    status:
      text(payment?.status) ?? text(subscription?.status) ?? text(checkout?.status),
    dueDate: text(payment?.dueDate),
    nextDueDate: text(subscription?.nextDueDate) ?? text(checkoutSubscription?.nextDueDate),
  }
}

export function parseStoredEvent(value: unknown): BillingEventData | null {
  if (!isRecord(value)) return null
  const id = text(value.id)
  const type = text(value.type)
  if (!id || !type) return null

  return {
    id,
    type,
    dateCreated: text(value.dateCreated),
    checkoutId: text(value.checkoutId),
    subscriptionId: text(value.subscriptionId),
    paymentId: text(value.paymentId),
    customerId: text(value.customerId),
    externalReference: text(value.externalReference),
    valueCents: typeof value.valueCents === 'number' ? value.valueCents : null,
    status: text(value.status),
    dueDate: text(value.dueDate),
    nextDueDate: text(value.nextDueDate),
  }
}
