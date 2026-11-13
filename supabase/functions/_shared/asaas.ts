/**
 * Cliente mínimo do Asaas. Nunca roda no navegador.
 * Preço é sempre fixado aqui no servidor; o frontend não envia valor.
 */
import { SUBSCRIPTION_CYCLE, type VerifiedProviderState } from './billing.ts'
import { planLabel, type PlanCode } from './plans.ts'

export interface AsaasConfig {
  apiKey: string
  apiBaseUrl: string
  checkoutBaseUrl: string
  appUrl: string
}

export interface CheckoutResult {
  id: string
  link: string
  status: string | null
}

export class AsaasError extends Error {
  readonly status: number
  readonly safeDetail: string

  constructor(status: number, safeDetail: string) {
    super('asaas_request_failed')
    this.name = 'AsaasError'
    this.status = status
    this.safeDetail = safeDetail
  }
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

export function asaasConfigFromEnv(
  readEnv: (name: string) => string | undefined,
): AsaasConfig | null {
  const apiKey = readEnv('ASAAS_API_KEY')?.trim()
  if (!apiKey) return null

  return {
    apiKey,
    apiBaseUrl: trimBaseUrl(readEnv('ASAAS_API_BASE_URL')?.trim() || 'https://api-sandbox.asaas.com'),
    checkoutBaseUrl: trimBaseUrl(
      readEnv('ASAAS_CHECKOUT_BASE_URL')?.trim() || 'https://sandbox.asaas.com',
    ),
    appUrl: trimBaseUrl(readEnv('APP_URL')?.trim() || readEnv('APP_ORIGIN')?.split(',')[0]?.trim() || 'http://localhost:5173'),
  }
}

export function formatAsaasDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function nextFirstDueDate(now: Date = new Date()): string {
  return formatAsaasDate(new Date(now.getTime() + 24 * 60 * 60 * 1000))
}

export class AsaasClient {
  private readonly config: AsaasConfig
  private readonly fetchImpl: typeof fetch

  constructor(config: AsaasConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config
    this.fetchImpl = fetchImpl
  }

  get checkoutBaseUrl(): string {
    return this.config.checkoutBaseUrl
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PedeOutra/0.1',
        access_token: this.config.apiKey,
        ...(init.headers ?? {}),
      },
    })

    const text = await response.text()
    let payload: Record<string, unknown> | null = null
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>
      } catch {
        payload = null
      }
    }

    if (!response.ok) {
      const errors = Array.isArray(payload?.errors) ? payload.errors : []
      const first = errors[0] as { description?: unknown; code?: unknown } | undefined
      const detail =
        typeof first?.description === 'string'
          ? first.description.slice(0, 200)
          : `status_${response.status}`
      throw new AsaasError(response.status, detail)
    }

    return payload ?? {}
  }

  async createRecurringCheckout(input: {
    organizationId: string
    planCode: PlanCode
    priceCents: number
    now?: Date
  }): Promise<CheckoutResult> {
    const now = input.now ?? new Date()
    if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) {
      throw new AsaasError(400, 'invalid_plan_price')
    }
    const payload = await this.request('/v3/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        minutesToExpire: 60,
        externalReference: input.organizationId,
        callback: {
          successUrl: `${this.config.appUrl}/app/assinatura?checkout=success`,
          cancelUrl: `${this.config.appUrl}/app/assinatura?checkout=cancel`,
          expiredUrl: `${this.config.appUrl}/app/assinatura?checkout=expired`,
        },
        items: [
          {
            name: `PedeOutra ${planLabel(input.planCode)} mensal`,
            description: `Plano ${planLabel(input.planCode)} — R$ ${(input.priceCents / 100)
              .toFixed(2)
              .replace('.', ',')}/mês`,
            quantity: 1,
            value: input.priceCents / 100,
          },
        ],
        subscription: {
          cycle: SUBSCRIPTION_CYCLE,
          nextDueDate: nextFirstDueDate(now),
        },
      }),
    })

    const id = typeof payload.id === 'string' ? payload.id : ''
    if (!id) throw new AsaasError(502, 'checkout_id_missing')

    const link =
      typeof payload.link === 'string' && payload.link
        ? payload.link
        : `${this.config.checkoutBaseUrl}/checkoutSession/show?id=${encodeURIComponent(id)}`

    return {
      id,
      link,
      status: typeof payload.status === 'string' ? payload.status : null,
    }
  }

  async getCheckout(id: string): Promise<VerifiedProviderState> {
    const payload = await this.request(`/v3/checkouts/${encodeURIComponent(id)}`)
    return {
      checkoutId: typeof payload.id === 'string' ? payload.id : id,
      checkoutStatus: typeof payload.status === 'string' ? payload.status : null,
      externalReference:
        typeof payload.externalReference === 'string' ? payload.externalReference : null,
    }
  }

  async getSubscription(id: string): Promise<VerifiedProviderState> {
    const payload = await this.request(`/v3/subscriptions/${encodeURIComponent(id)}`)
    return {
      subscriptionId: typeof payload.id === 'string' ? payload.id : id,
      subscriptionStatus: typeof payload.status === 'string' ? payload.status : null,
      nextDueDate: typeof payload.nextDueDate === 'string' ? payload.nextDueDate : null,
      checkoutId: typeof payload.checkoutSession === 'string' ? payload.checkoutSession : null,
      customerId: typeof payload.customer === 'string' ? payload.customer : null,
      externalReference:
        typeof payload.externalReference === 'string' ? payload.externalReference : null,
      valueCents: typeof payload.value === 'number' ? Math.round(payload.value * 100) : null,
    }
  }

  async getPayment(id: string): Promise<VerifiedProviderState> {
    const payload = await this.request(`/v3/payments/${encodeURIComponent(id)}`)
    return {
      paymentStatus: typeof payload.status === 'string' ? payload.status : null,
      subscriptionId: typeof payload.subscription === 'string' ? payload.subscription : null,
      checkoutId: typeof payload.checkoutSession === 'string' ? payload.checkoutSession : null,
      customerId: typeof payload.customer === 'string' ? payload.customer : null,
      externalReference:
        typeof payload.externalReference === 'string' ? payload.externalReference : null,
      valueCents: typeof payload.value === 'number' ? Math.round(payload.value * 100) : null,
    }
  }

  async cancelSubscription(id: string): Promise<void> {
    await this.request(`/v3/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}

export function asaasClientFromEnv(
  readEnv: (name: string) => string | undefined,
): AsaasClient | null {
  const config = asaasConfigFromEnv(readEnv)
  return config ? new AsaasClient(config) : null
}
