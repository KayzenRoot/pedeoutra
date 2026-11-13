import { describe, expect, it } from 'vitest'
import {
  buildOrderMessage,
  centsToInput,
  daysUntil,
  formatBRL,
  formatPhone,
  nextStatuses,
  parsePriceToCents,
  phoneDigits,
  slugify,
  whatsappLink,
} from './format'

describe('formatação e entrada de valores', () => {
  it('converte preço brasileiro para centavos', () => {
    expect(parsePriceToCents('12,50')).toBe(1250)
    expect(parsePriceToCents('1.234,56')).toBe(123456)
    expect(parsePriceToCents('12.50')).toBe(1250)
    expect(parsePriceToCents('0')).toBe(0)
    expect(parsePriceToCents('')).toBeNull()
    expect(parsePriceToCents('abc')).toBeNull()
    expect(parsePriceToCents('-1')).toBeNull()
  })

  it('formata centavos e valor nulo', () => {
    expect(formatBRL(null)).toBe('A combinar')
    expect(formatBRL(1250)).toContain('12,50')
  })

  it('converte centavos para input editável', () => {
    expect(centsToInput(1250)).toBe('12,50')
    expect(centsToInput(null)).toBe('')
  })

  it('formata telefone e normaliza dígitos', () => {
    expect(phoneDigits('(11) 99999-8888')).toBe('11999998888')
    expect(formatPhone('11999998888')).toBe('(11) 99999-8888')
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444')
  })

  it('monta link de WhatsApp com país', () => {
    const link = whatsappLink('11999998888', 'Olá')
    expect(link).toContain('https://wa.me/5511999998888')
    expect(link).toContain(encodeURIComponent('Olá'))
    expect(whatsappLink('123', 'x')).toBeNull()
  })
})

describe('status e mensagens', () => {
  it('define transições válidas', () => {
    expect(nextStatuses('new')).toEqual(['confirmed', 'canceled'])
    expect(nextStatuses('confirmed')).toEqual(['completed', 'canceled'])
    expect(nextStatuses('completed')).toEqual([])
    expect(nextStatuses('canceled')).toEqual([])
  })

  it('monta mensagem de confirmação sem dados extras', () => {
    const message = buildOrderMessage({
      organizationName: 'Aurora',
      reference: 'PD-123',
      items: [
        { name_snapshot: 'Copo', quantity: 2, unit_snapshot: 'cento' },
        { name_snapshot: 'Água', quantity: 3, unit_snapshot: 'galão' },
      ],
      totalCents: 5197,
    })
    expect(message).toContain('PD-123')
    expect(message).toContain('2x Copo')
    expect(message).toContain('3x Água')
    expect(message).toContain('51,97')
  })

  it('calcula dias restantes', () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(daysUntil(future)).toBeGreaterThanOrEqual(1)
    expect(daysUntil(null)).toBeNull()
  })

  it('gera slug estável sem acentos', () => {
    expect(slugify('Distribuidora Aurora Ltda.')).toBe('distribuidora-aurora-ltda')
    expect(slugify('Ação & Cia')).toBe('acao-cia')
  })
})
