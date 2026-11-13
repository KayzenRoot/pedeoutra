import { describe, expect, it } from 'vitest'
import {
  asaasDateToPeriodEnd,
  decideBillingTransition,
  toCents,
  validateBillingEvent,
  type BillingEventData,
  type SubscriptionSnapshot,
  type VerifiedProviderState,
} from './billing.ts'
import { parseAsaasEvent, parseStoredEvent } from './billing-event.ts'
import type { PlanPricing } from './plans.ts'

const NOW = new Date('2026-11-12T12:00:00Z')
const ORG = '44444444-4444-4444-8444-444444444444'
const ESSENTIAL: PlanPricing = {
  plan_code: 'essential',
  plan_version: 1,
  price_cents: 2990,
  currency: 'BRL',
  trial_days: 7,
}
const PROFESSIONAL: PlanPricing = {
  plan_code: 'professional',
  plan_version: 1,
  price_cents: 6990,
  currency: 'BRL',
  trial_days: 0,
}

function snapshot(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    state: 'pending',
    currentPeriodEnd: null,
    providerSubscriptionId: null,
    providerCheckoutId: 'chk_1',
    providerCustomerId: 'cus_1',
    lastProviderEventAt: null,
    ...overrides,
  }
}

function event(overrides: Partial<BillingEventData> = {}): BillingEventData {
  return {
    id: 'evt_1',
    type: 'PAYMENT_RECEIVED',
    dateCreated: '2026-11-12 10:00:00',
    checkoutId: 'chk_1',
    subscriptionId: 'sub_1',
    paymentId: 'pay_1',
    customerId: 'cus_1',
    externalReference: ORG,
    valueCents: ESSENTIAL.price_cents,
    status: 'RECEIVED',
    dueDate: '2026-11-12',
    nextDueDate: '2026-12-12',
    ...overrides,
  }
}

function verified(overrides: Partial<VerifiedProviderState> = {}): VerifiedProviderState {
  return {
    checkoutStatus: 'PAID',
    subscriptionId: 'sub_1',
    subscriptionStatus: 'ACTIVE',
    paymentStatus: 'RECEIVED',
    nextDueDate: '2026-12-12',
    externalReference: ORG,
    valueCents: ESSENTIAL.price_cents,
    ...overrides,
  }
}

describe('validação de evento de billing', () => {
  it('aceita evento com valor e tenant corretos', () => {
    expect(validateBillingEvent(event(), ORG, verified(), ESSENTIAL)).toEqual({ ok: true })
  })

  it('rejeita tenant divergente no evento ou no provedor', () => {
    expect(validateBillingEvent(event({ externalReference: 'outra-org' }), ORG, verified(), ESSENTIAL)).toEqual({
      ok: false,
      reason: 'tenant_mismatch',
    })
    expect(
      validateBillingEvent(event(), ORG, verified({ externalReference: 'outra-org' }), ESSENTIAL),
    ).toEqual({ ok: false, reason: 'tenant_mismatch' })
  })

  it('rejeita valor adulterado', () => {
    expect(validateBillingEvent(event({ valueCents: 2890 }), ORG, null, ESSENTIAL)).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    })
    expect(validateBillingEvent(event({ valueCents: null }), ORG, verified({ valueCents: 1 }), ESSENTIAL)).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    })
  })

  it('valida o valor contra o plano da assinatura, não contra constante global', () => {
    expect(
      validateBillingEvent(
        event({ valueCents: 6990 }),
        ORG,
        verified({ valueCents: 6990 }),
        ESSENTIAL,
      ),
    ).toEqual({ ok: false, reason: 'amount_mismatch' })

    expect(
      validateBillingEvent(
        event({ valueCents: 2990 }),
        ORG,
        verified({ valueCents: 2990 }),
        PROFESSIONAL,
      ),
    ).toEqual({ ok: false, reason: 'amount_mismatch' })

    expect(
      validateBillingEvent(
        event({ valueCents: 6990 }),
        ORG,
        verified({ valueCents: 6990 }),
        PROFESSIONAL,
      ),
    ).toEqual({ ok: true })
  })

  it('rejeita catálogo de plano com moeda/preço inválido', () => {
    expect(
      validateBillingEvent(event(), ORG, verified(), {
        ...ESSENTIAL,
        currency: 'USD',
      }),
    ).toEqual({ ok: false, reason: 'plan_mismatch' })
  })

  it('não ativa quando o valor não foi comprovado', () => {
    expect(validateBillingEvent(event({ valueCents: null }), ORG, null, ESSENTIAL)).toEqual({
      ok: false,
      reason: 'amount_unverified',
    })
  })

  it('não exige valor para eventos não financeiros', () => {
    expect(
      validateBillingEvent(
        event({ type: 'SUBSCRIPTION_DELETED', valueCents: null }),
        ORG,
        null,
        ESSENTIAL,
      ),
    ).toEqual({ ok: true })
  })
})

describe('máquina de estados de billing', () => {
  it('CHECKOUT_PAID verificado ativa e define período', () => {
    const decision = decideBillingTransition(
      snapshot(),
      event({ type: 'CHECKOUT_PAID' }),
      verified({ paymentStatus: null }),
      NOW,
    )
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.state).toBe('active')
    expect(decision.currentPeriodEnd).toBe('2026-12-13T02:59:59.000Z')
    expect(decision.reason).toBe('checkout_paid_verified')
  })

  it('CHECKOUT_PAID não reativa assinatura reembolsada', () => {
    expect(
      decideBillingTransition(
        snapshot({ state: 'refunded' }),
        event({ type: 'CHECKOUT_PAID' }),
        verified({ paymentStatus: null }),
        NOW,
      ),
    ).toEqual({ kind: 'ignore', reason: 'refunded_is_terminal' })
  })

  it('CHECKOUT_PAID sem assinatura em nenhuma fonte pede verificação', () => {
    expect(
      decideBillingTransition(
        snapshot({ providerSubscriptionId: null }),
        event({ type: 'CHECKOUT_PAID', subscriptionId: null }),
        verified({ paymentStatus: null, subscriptionId: null }),
        NOW,
      ),
    ).toEqual({ kind: 'verify', reason: 'subscription_not_found' })
  })

  it('CHECKOUT_PAID usa assinatura já correlacionada no snapshot', () => {
    const decision = decideBillingTransition(
      snapshot({
        state: 'pending',
        providerSubscriptionId: 'sub_1',
        currentPeriodEnd: '2026-12-13T02:59:59.000Z',
      }),
      event({ type: 'CHECKOUT_PAID', subscriptionId: null, nextDueDate: null }),
      verified({ paymentStatus: null, subscriptionId: null, nextDueDate: null }),
      NOW,
    )
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.state).toBe('active')
    expect(decision.providerSubscriptionId).toBe('sub_1')
    expect(decision.currentPeriodEnd).toBe('2026-12-13T02:59:59.000Z')
  })

  it('SUBSCRIPTION_CREATED permanece pendente e grava o período', () => {
    const decision = decideBillingTransition(
      snapshot({ providerSubscriptionId: null, currentPeriodEnd: null }),
      event({ type: 'SUBSCRIPTION_CREATED', paymentId: null, dueDate: null }),
      verified({ paymentStatus: null }),
      NOW,
    )
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.state).toBe('pending')
    expect(decision.currentPeriodEnd).toBe('2026-12-13T02:59:59.000Z')
    expect(decision.providerSubscriptionId).toBe('sub_1')
  })

  it('CHECKOUT_PAID não verificado não ativa', () => {
    expect(
      decideBillingTransition(snapshot(), event({ type: 'CHECKOUT_PAID' }), null, NOW),
    ).toEqual({ kind: 'verify', reason: 'checkout_not_verified' })

    expect(
      decideBillingTransition(
        snapshot(),
        event({ type: 'CHECKOUT_PAID' }),
        verified({ checkoutStatus: 'ACTIVE', subscriptionStatus: 'ACTIVE', paymentStatus: null }),
        NOW,
      ),
    ).toEqual({ kind: 'verify', reason: 'checkout_not_paid' })
  })

  it('pagamento recebido ativa somente com status confirmado', () => {
    const decision = decideBillingTransition(snapshot(), event(), verified(), NOW)
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.state).toBe('active')
    expect(decision.providerSubscriptionId).toBe('sub_1')

    expect(
      decideBillingTransition(snapshot(), event(), verified({ paymentStatus: 'PENDING' }), NOW),
    ).toEqual({ kind: 'verify', reason: 'payment_not_confirmed' })
  })

  it('evento fora de ordem é ignorado', () => {
    const decision = decideBillingTransition(
      snapshot({ lastProviderEventAt: '2026-11-12T15:00:00.000Z' }),
      event({ dateCreated: '2026-11-12 09:00:00' }),
      verified(),
      NOW,
    )
    expect(decision).toEqual({ kind: 'ignore', reason: 'stale_event' })
  })

  it('reembolso vence até evento antigo e limpa acesso', () => {
    const decision = decideBillingTransition(
      snapshot({
        state: 'active',
        currentPeriodEnd: '2026-12-13T02:59:59.000Z',
        providerSubscriptionId: 'sub_1',
        lastProviderEventAt: '2026-11-20T00:00:00.000Z',
      }),
      event({ type: 'PAYMENT_REFUNDED', dateCreated: '2026-11-01 09:00:00', valueCents: 2990 }),
      verified({ paymentStatus: 'REFUNDED' }),
      NOW,
    )
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.state).toBe('refunded')
    expect(decision.currentPeriodEnd).toBeNull()
  })

  it('atraso vira past_due e preserva período', () => {
    const decision = decideBillingTransition(
      snapshot({
        state: 'active',
        currentPeriodEnd: '2026-12-01T00:00:00.000Z',
        providerSubscriptionId: 'sub_1',
      }),
      event({ type: 'PAYMENT_OVERDUE' }),
      null,
      NOW,
    )
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.state).toBe('past_due')
    expect(decision.currentPeriodEnd).toBe('2026-12-01T00:00:00.000Z')
  })

  it('cancelamento mantém acesso até o fim do período', () => {
    const decision = decideBillingTransition(
      snapshot({
        state: 'active',
        currentPeriodEnd: '2026-12-01T00:00:00.000Z',
        providerSubscriptionId: 'sub_1',
      }),
      event({ type: 'SUBSCRIPTION_DELETED' }),
      null,
      NOW,
    )
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.state).toBe('canceled')
    expect(decision.currentPeriodEnd).toBe('2026-12-01T00:00:00.000Z')
  })

  it('pagamento após cancelamento não reativa', () => {
    expect(
      decideBillingTransition(
        snapshot({ state: 'canceled', providerSubscriptionId: 'sub_1' }),
        event(),
        verified(),
        NOW,
      ),
    ).toEqual({ kind: 'ignore', reason: 'payment_after_cancellation' })
  })

  it('checkout expirado só altera assinatura pendente', () => {
    const expired = decideBillingTransition(
      snapshot(),
      event({ type: 'CHECKOUT_EXPIRED' }),
      null,
      NOW,
    )
    expect(expired.kind).toBe('apply')
    if (expired.kind !== 'apply') return
    expect(expired.state).toBe('expired')

    expect(
      decideBillingTransition(
        snapshot({ state: 'active', providerSubscriptionId: 'sub_1' }),
        event({ type: 'CHECKOUT_EXPIRED' }),
        null,
        NOW,
      ),
    ).toEqual({ kind: 'ignore', reason: 'non_pending_checkout' })
  })

  it('evento desconhecido é ignorado', () => {
    expect(
      decideBillingTransition(snapshot(), event({ type: 'CHECKOUT_CREATED' }), null, NOW),
    ).toEqual({ kind: 'ignore', reason: 'unknown_event' })
  })

  it('usa fallback de 30 dias quando não há nextDueDate', () => {
    const decision = decideBillingTransition(
      snapshot(),
      event({ nextDueDate: null, dueDate: null }),
      verified({ nextDueDate: null }),
      NOW,
    )
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.currentPeriodEnd).not.toBeNull()
    const period = Date.parse(decision.currentPeriodEnd ?? '')
    expect(period).toBeGreaterThan(NOW.getTime() + 29 * 24 * 60 * 60 * 1000)
  })
})

describe('parsing de eventos e valores', () => {
  it('converte valores BRL para centavos', () => {
    expect(toCents(29.9)).toBe(2990)
    expect(toCents('29.90')).toBe(2990)
    expect(toCents(null)).toBeNull()
    expect(toCents('abc')).toBeNull()
  })

  it('interpreta data-only como fim do dia em São Paulo', () => {
    expect(asaasDateToPeriodEnd('2026-12-12')).toBe('2026-12-13T02:59:59.000Z')
  })

  it('extrai evento de pagamento do payload Asaas', () => {
    const parsed = parseAsaasEvent({
      id: 'evt_1',
      event: 'PAYMENT_RECEIVED',
      dateCreated: '2026-11-12 10:00:00',
      payment: {
        id: 'pay_1',
        customer: 'cus_1',
        subscription: 'sub_1',
        value: 29.9,
        status: 'RECEIVED',
        externalReference: ORG,
        dueDate: '2026-11-12',
      },
    })
    expect(parsed).toMatchObject({
      id: 'evt_1',
      type: 'PAYMENT_RECEIVED',
      subscriptionId: 'sub_1',
      valueCents: 2990,
      status: 'RECEIVED',
      externalReference: ORG,
    })
  })

  it('soma itens do checkout pago', () => {
    const parsed = parseAsaasEvent({
      id: 'evt_2',
      event: 'CHECKOUT_PAID',
      checkout: {
        id: 'chk_1',
        status: 'PAID',
        externalReference: ORG,
        items: [{ value: 29.9, quantity: 1 }],
      },
    })
    expect(parsed?.checkoutId).toBe('chk_1')
    expect(parsed?.valueCents).toBe(2990)
  })

  it('rejeita payload sem id/evento', () => {
    expect(parseAsaasEvent({})).toBeNull()
    expect(parseAsaasEvent({ id: 'evt', event: '' })).toBeNull()
  })

  it('lê evento persistido mínimo', () => {
    const parsed = parseStoredEvent({
      id: 'evt_1',
      type: 'PAYMENT_RECEIVED',
      subscriptionId: 'sub_1',
      valueCents: 2990,
    })
    expect(parsed?.type).toBe('PAYMENT_RECEIVED')
    expect(parsed?.valueCents).toBe(2990)
  })
})
