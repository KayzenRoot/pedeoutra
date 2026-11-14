import { describe, expect, it } from 'vitest'
import {
  createOrderReceiptPdf,
  orderReceiptFilename,
  type OrderReceiptInput,
} from './order-pdf'

const baseInput: OrderReceiptInput = {
  organizationName: 'Distribuidora Aurora',
  reference: 'PD-ABC123',
  createdAt: '2026-11-14T12:00:00Z',
  status: 'confirmed',
  items: [
    {
      name: 'Copo d’água 200ml',
      unit: 'cento',
      quantity: 2,
      unitPriceCents: 1250,
      subtotalCents: 2500,
    },
  ],
  totalCents: 2500,
  buyerName: 'Padaria Pão Bom',
  buyerPhone: '11977776666',
  includeBuyer: true,
  includePrices: true,
}

function decodePdf(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes)
}

describe('comprovante de pedido em PDF', () => {
  it('gera PDF A4 com referência, itens, total e aviso não fiscal', () => {
    const pdf = decodePdf(createOrderReceiptPdf(baseInput))
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]')
    expect(pdf).toContain('PD-ABC123')
    expect(pdf).toContain("Copo d'água 200ml")
    expect(pdf).toContain('R$ 25,00')
    expect(pdf).toContain('Comprovante de pedido, não é documento fiscal nem prova de pagamento.')
    expect(pdf).toContain('Padaria Pão Bom')
    expect(pdf).toContain('11977776666')
    expect(pdf).toContain('%%EOF')
  })

  it('omite comprador e preços na versão pública reduzida', () => {
    const pdf = decodePdf(
      createOrderReceiptPdf({
        ...baseInput,
        includeBuyer: false,
        includePrices: false,
        documentTitle: 'Comprovante de acompanhamento',
        totalCents: null,
      }),
    )
    expect(pdf).not.toContain('Padaria Pão Bom')
    expect(pdf).not.toContain('11977776666')
    expect(pdf).not.toContain('R$ 12,50')
    expect(pdf).toContain('Comprovante de acompanhamento')
    expect(pdf).toContain('A combinar')
  })

  it('pagina 50 itens e mantém o rodapé em todas as páginas', () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      name: `Produto ${index + 1} com nome suficientemente longo para quebrar linha`,
      unit: 'un',
      quantity: index + 1,
      unitPriceCents: 100 + index,
      subtotalCents: (100 + index) * (index + 1),
    }))
    const pdf = decodePdf(
      createOrderReceiptPdf({
        ...baseInput,
        items,
        totalCents: items.reduce((total, item) => total + (item.subtotalCents ?? 0), 0),
      }),
    )
    const pageCount = (pdf.match(/\/Type \/Page\b/g) ?? []).length
    expect(pageCount).toBeGreaterThan(1)
    expect(pdf).toContain(`/Count ${pageCount}`)
    expect((pdf.match(/Página \d+ de \d+/g) ?? []).length).toBe(pageCount)
    expect((pdf.match(/não é documento fiscal/g) ?? []).length).toBe(pageCount)
  })

  it('sanitiza nome de arquivo', () => {
    expect(orderReceiptFilename('PD-ABC/123?', true)).toBe('comprovante-PD-ABC123.pdf')
    expect(orderReceiptFilename('PD-ABC123', false)).toBe('comprovante-PD-ABC123-sem-pii.pdf')
    expect(orderReceiptFilename('../../', true)).toBe('comprovante-pedido.pdf')
  })
})
