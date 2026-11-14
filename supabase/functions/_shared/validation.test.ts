import { describe, expect, it } from 'vitest'
import {
  MAX_ITEMS,
  MAX_NOTE_LENGTH,
  MAX_QUANTITY,
  normalizePhone,
  parsePublicOrderInput,
  parseQuoteAcceptInput,
  parseQuoteCreateInput,
  parseQuoteUpdateInput,
  parseReorderInput,
} from './validation.ts'

const PRODUCT_A = '11111111-1111-4111-8111-111111111111'
const PRODUCT_B = '22222222-2222-4222-8222-222222222222'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'

function validOrder(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'distribuidora-aurora-abc123',
    buyer_name: 'Padaria Pão Bom',
    buyer_phone: '(11) 97777-6666',
    note: 'Entregar pela manhã',
    items: [{ product_id: PRODUCT_A, quantity: 2 }],
    company_website: '',
    elapsed_ms: 2500,
    consent: true,
    request_id: REQUEST_ID,
    ...overrides,
  }
}

describe('validação de pedido público', () => {
  it('aceita payload válido e normaliza telefone/espaços', () => {
    const result = parsePublicOrderInput(validOrder())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.buyerPhone).toBe('11977776666')
    expect(result.value.buyerName).toBe('Padaria Pão Bom')
    expect(result.value.slug).toBe('distribuidora-aurora-abc123')
    expect(result.value.items).toEqual([{ product_id: PRODUCT_A, quantity: 2 }])
  })

  it('rejeita honeypot preenchido', () => {
    const result = parsePublicOrderInput(validOrder({ company_website: 'spam' }))
    expect(result).toEqual({ ok: false, error: 'spam_detected' })
  })

  it('rejeita envio rápido demais', () => {
    const result = parsePublicOrderInput(validOrder({ elapsed_ms: 100 }))
    expect(result).toEqual({ ok: false, error: 'spam_detected' })
  })

  it('exige consentimento e request_id válido', () => {
    expect(parsePublicOrderInput(validOrder({ consent: false }))).toEqual({
      ok: false,
      error: 'consent_required',
    })
    expect(parsePublicOrderInput(validOrder({ request_id: 'abc' }))).toEqual({
      ok: false,
      error: 'invalid_request_id',
    })
  })

  it('valida nome, telefone, slug e observação', () => {
    expect(parsePublicOrderInput(validOrder({ buyer_name: 'X' })).ok).toBe(false)
    expect(parsePublicOrderInput(validOrder({ buyer_phone: '123' })).ok).toBe(false)
    expect(parsePublicOrderInput(validOrder({ slug: '../etc' })).ok).toBe(false)
    expect(
      parsePublicOrderInput(validOrder({ note: 'a'.repeat(MAX_NOTE_LENGTH + 1) })).ok,
    ).toBe(false)
  })

  it('limita quantidade, itens e duplicidade', () => {
    expect(
      parsePublicOrderInput(validOrder({ items: [{ product_id: PRODUCT_A, quantity: 0 }] })).ok,
    ).toBe(false)
    expect(
      parsePublicOrderInput(
        validOrder({ items: [{ product_id: PRODUCT_A, quantity: MAX_QUANTITY + 1 }] }),
      ).ok,
    ).toBe(false)
    expect(
      parsePublicOrderInput(
        validOrder({
          items: [
            { product_id: PRODUCT_A, quantity: 1 },
            { product_id: PRODUCT_A, quantity: 2 },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: 'duplicate_items' })
    expect(
      parsePublicOrderInput(
        validOrder({
          items: Array.from({ length: MAX_ITEMS + 1 }, (_, index) => ({
            product_id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
            quantity: 1,
          })),
        }),
      ).ok,
    ).toBe(false)
  })

  it('rejeita UUID inválido', () => {
    expect(
      parsePublicOrderInput(validOrder({ items: [{ product_id: 'produto', quantity: 1 }] })).ok,
    ).toBe(false)
  })

  it('aceita link de preço sem nome/telefone e ignora PII enviada', () => {
    const token = 'A'.repeat(43)
    const result = parsePublicOrderInput(
      validOrder({
        price_token: token,
        buyer_name: '',
        buyer_phone: '',
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.priceToken).toBe(token)
    expect(result.value.buyerName).toBeNull()
    expect(result.value.buyerPhone).toBeNull()

    const withPii = parsePublicOrderInput(validOrder({ price_token: token }))
    expect(withPii.ok).toBe(true)
    if (!withPii.ok) return
    expect(withPii.value.buyerName).toBeNull()
    expect(withPii.value.buyerPhone).toBeNull()
  })

  it('rejeita token de preço com formato inválido', () => {
    expect(parsePublicOrderInput(validOrder({ price_token: 'curto' }))).toEqual({
      ok: false,
      error: 'invalid_price_token',
    })
    expect(
      parsePublicOrderInput(validOrder({ price_token: `${'A'.repeat(42)}!` })),
    ).toEqual({ ok: false, error: 'invalid_price_token' })
  })

  it('sem token continua exigindo nome e telefone', () => {
    expect(parsePublicOrderInput(validOrder({ buyer_name: '' }))).toEqual({
      ok: false,
      error: 'invalid_buyer_name',
    })
    expect(parsePublicOrderInput(validOrder({ buyer_phone: '' }))).toEqual({
      ok: false,
      error: 'invalid_buyer_phone',
    })
  })
})

describe('validação de recompra', () => {
  const validReorder = {
    items: [
      { product_id: PRODUCT_A, quantity: 3 },
      { product_id: PRODUCT_B, quantity: 1 },
    ],
    company_website: '',
    elapsed_ms: 2000,
    request_id: REQUEST_ID,
  }

  it('aceita recompra sem PII e normaliza', () => {
    const result = parseReorderInput(validReorder)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items).toHaveLength(2)
    expect(result.value.requestId).toBe(REQUEST_ID)
  })

  it('rejeita lista vazia e duplicados', () => {
    expect(parseReorderInput({ ...validReorder, items: [] }).ok).toBe(false)
    expect(
      parseReorderInput({
        ...validReorder,
        items: [
          { product_id: PRODUCT_A, quantity: 1 },
          { product_id: PRODUCT_A, quantity: 1 },
        ],
      }),
    ).toEqual({ ok: false, error: 'duplicate_items' })
  })
})

describe('normalizePhone', () => {
  it('remove máscara e exige 10..15 dígitos', () => {
    expect(normalizePhone('(11) 99999-8888')).toBe('11999998888')
    expect(normalizePhone('+55 11 99999-8888')).toBe('5511999998888')
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('1'.repeat(16))).toBeNull()
  })
})

describe('validação de orçamento', () => {
  const quoteInput = {
    customer_id: '44444444-4444-4444-8444-444444444444',
    items: [{ product_id: PRODUCT_A, quantity: 2 }],
    valid_until: '2026-11-21T23:59:59.000Z',
    notes: 'Entrega em 3 dias',
  }

  it('aceita criação e atualização válidas', () => {
    const created = parseQuoteCreateInput(quoteInput)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.customerId).toBe(quoteInput.customer_id)
    expect(created.value.items).toHaveLength(1)

    const updated = parseQuoteUpdateInput({
      ...quoteInput,
      quote_id: '55555555-5555-4555-8555-555555555555',
      expected_version: 3,
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value.expectedVersion).toBe(3)
  })

  it('rejeita cliente, validade, notas e versão inválidos', () => {
    expect(parseQuoteCreateInput({ ...quoteInput, customer_id: 'x' })).toEqual({
      ok: false,
      error: 'invalid_customer',
    })
    expect(parseQuoteCreateInput({ ...quoteInput, valid_until: 'ontem' })).toEqual({
      ok: false,
      error: 'invalid_quote_validity',
    })
    expect(parseQuoteCreateInput({ ...quoteInput, notes: 'a'.repeat(1001) })).toEqual({
      ok: false,
      error: 'invalid_quote_notes',
    })
    expect(
      parseQuoteUpdateInput({
        ...quoteInput,
        quote_id: '55555555-5555-4555-8555-555555555555',
        expected_version: 0,
      }),
    ).toEqual({ ok: false, error: 'invalid_version' })
  })

  it('aceite exige confirmação, token e anti-spam', () => {
    const token = 'A'.repeat(43)
    const base = {
      token,
      confirm: true,
      request_id: REQUEST_ID,
      company_website: '',
      elapsed_ms: 2000,
    }
    expect(parseQuoteAcceptInput(base).ok).toBe(true)
    expect(parseQuoteAcceptInput({ ...base, confirm: false })).toEqual({
      ok: false,
      error: 'confirm_required',
    })
    expect(parseQuoteAcceptInput({ ...base, token: 'curto' })).toEqual({
      ok: false,
      error: 'invalid_quote_token',
    })
    expect(parseQuoteAcceptInput({ ...base, elapsed_ms: 10 })).toEqual({
      ok: false,
      error: 'spam_detected',
    })
  })
})
