import { describe, expect, it, vi } from 'vitest'
import {
  AsaasClient,
  AsaasError,
  asaasConfigFromEnv,
  formatAsaasDate,
  nextFirstDueDate,
} from './asaas.ts'

const ORG = '44444444-4444-4444-8444-444444444444'

function config() {
  return {
    apiKey: 'test-key',
    apiBaseUrl: 'https://api-sandbox.asaas.com',
    checkoutBaseUrl: 'https://sandbox.asaas.com',
    appUrl: 'https://app.pedeoutra.test',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('configuração do Asaas', () => {
  it('retorna null sem API key', () => {
    expect(asaasConfigFromEnv(() => undefined)).toBeNull()
  })

  it('usa sandbox por padrão e APP_URL', () => {
    const cfg = asaasConfigFromEnv((name) => {
      if (name === 'ASAAS_API_KEY') return 'key'
      if (name === 'APP_URL') return 'https://app.test/'
      return undefined
    })
    expect(cfg).toMatchObject({
      apiKey: 'key',
      apiBaseUrl: 'https://api-sandbox.asaas.com',
      checkoutBaseUrl: 'https://sandbox.asaas.com',
      appUrl: 'https://app.test',
    })
  })
})

describe('AsaasClient', () => {
  it('cria checkout recorrente com preço e tenant fixados no servidor', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} }
      return jsonResponse({
        id: 'chk_1',
        link: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_1',
        status: 'ACTIVE',
      })
    })

    const client = new AsaasClient(config(), fetchMock as unknown as typeof fetch)
    const result = await client.createRecurringCheckout({
      organizationId: ORG,
      now: new Date('2026-11-12T12:00:00Z'),
    })

    expect(result).toEqual({
      id: 'chk_1',
      link: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_1',
      status: 'ACTIVE',
    })

    expect(captured).not.toBeNull()
    const { url, init } = captured as { url: string; init: RequestInit }
    expect(url).toBe('https://api-sandbox.asaas.com/v3/checkouts')
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers.access_token).toBe('test-key')
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.billingTypes).toEqual(['CREDIT_CARD'])
    expect(body.chargeTypes).toEqual(['RECURRENT'])
    expect(body.externalReference).toBe(ORG)
    expect(body.items).toEqual([
      {
        name: 'PedeOutra mensal',
        description: 'Plano único R$ 29,90/mês',
        quantity: 1,
        value: 29.9,
      },
    ])
    expect(body.subscription).toMatchObject({
      cycle: 'MONTHLY',
      nextDueDate: '2026-11-13',
    })
    expect(body.callback).toMatchObject({
      successUrl: 'https://app.pedeoutra.test/app/assinatura?checkout=success',
    })
  })

  it('usa fallback de link quando a resposta não traz link', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'chk_2' }))
    const client = new AsaasClient(config(), fetchMock as unknown as typeof fetch)
    const result = await client.createRecurringCheckout({
      organizationId: ORG,
    })
    expect(result.link).toBe('https://sandbox.asaas.com/checkoutSession/show?id=chk_2')
  })

  it('lança AsaasError seguro em erro do provedor', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ errors: [{ code: 'invalid', description: 'Valor inválido' }] }, 400),
    )
    const client = new AsaasClient(config(), fetchMock as unknown as typeof fetch)

    await expect(
      client.createRecurringCheckout({
        organizationId: ORG,
      }),
    ).rejects.toMatchObject({ status: 400, safeDetail: 'Valor inválido' })
  })

  it('consulta assinatura e pagamento', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/subscriptions/')) {
        return jsonResponse({
          id: 'sub_1',
          status: 'ACTIVE',
          nextDueDate: '2026-12-12',
          externalReference: ORG,
          value: 29.9,
          checkoutSession: 'chk_1',
          customer: 'cus_1',
        })
      }
      return jsonResponse({
        id: 'pay_1',
        status: 'RECEIVED',
        subscription: 'sub_1',
        externalReference: ORG,
        value: 29.9,
        checkoutSession: 'chk_1',
        customer: 'cus_1',
      })
    })
    const client = new AsaasClient(config(), fetchMock as unknown as typeof fetch)

    await expect(client.getSubscription('sub_1')).resolves.toEqual({
      subscriptionId: 'sub_1',
      subscriptionStatus: 'ACTIVE',
      nextDueDate: '2026-12-12',
      checkoutId: 'chk_1',
      customerId: 'cus_1',
      externalReference: ORG,
      valueCents: 2990,
    })
    await expect(client.getPayment('pay_1')).resolves.toEqual({
      paymentStatus: 'RECEIVED',
      subscriptionId: 'sub_1',
      checkoutId: 'chk_1',
      customerId: 'cus_1',
      externalReference: ORG,
      valueCents: 2990,
    })
  })

  it('cancela assinatura via DELETE', async () => {
    let method = ''
    let url = ''
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input)
      method = init?.method ?? 'GET'
      return jsonResponse({ deleted: true })
    })
    const client = new AsaasClient(config(), fetchMock as unknown as typeof fetch)
    await client.cancelSubscription('sub_1')
    expect(method).toBe('DELETE')
    expect(url).toBe('https://api-sandbox.asaas.com/v3/subscriptions/sub_1')
  })
})

describe('datas Asaas', () => {
  it('formata YYYY-MM-DD', () => {
    expect(formatAsaasDate(new Date('2026-11-12T23:30:00Z'))).toBe('2026-11-12')
    expect(nextFirstDueDate(new Date('2026-11-12T12:00:00Z'))).toBe('2026-11-13')
  })

  it('AsaasError preserva status e detalhe seguro', () => {
    const error = new AsaasError(502, 'timeout')
    expect(error.status).toBe(502)
    expect(error.safeDetail).toBe('timeout')
  })
})
