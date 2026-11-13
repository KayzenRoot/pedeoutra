import { describe, expect, it } from 'vitest'
import { parseSkuList, resolveSkuLines, type SkuProduct } from './sku'

const products: SkuProduct[] = [
  { id: 'p1', name: 'Copo', unit: 'cento', price_cents: 1250, sku: 'COPO-200' },
  { id: 'p2', name: 'Água', unit: 'galão', price_cents: 899, sku: 'AGUA-5L' },
  { id: 'p3', name: 'Sem SKU', unit: 'un', price_cents: null, sku: null },
]

describe('lista de SKU', () => {
  it('aceita linhas com espaço, vírgula e comentários', () => {
    const lines = parseSkuList('copo-200 2\n# comentário\nAGUA-5L,3\n\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ sku: 'COPO-200', quantity: 2, error: null })
    expect(lines[1]).toMatchObject({ sku: 'AGUA-5L', quantity: 3, error: null })
  })

  it('rejeita SKU e quantidade inválidos sem lançar exceção', () => {
    const lines = parseSkuList('!! 2\nCOPO-200 zero\nAGUA-5L 1000')
    expect(lines.every((line) => line.error !== null)).toBe(true)
  })

  it('resolve SKUs do tenant e agrega duplicados', () => {
    const result = resolveSkuLines(parseSkuList('COPO-200 2\ncopo-200 3'), products)
    expect(result.errors).toEqual([])
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ product: { id: 'p1' }, quantity: 5 })
  })

  it('não inventa produto para SKU desconhecido e limita a 999', () => {
    const unknown = resolveSkuLines(parseSkuList('OUTRO 1'), products)
    expect(unknown.matches).toHaveLength(0)
    expect(unknown.errors[0]).toContain('não encontrado')

    const overflow = resolveSkuLines(parseSkuList('COPO-200 999\nCOPO-200 1'), products)
    expect(overflow.matches).toHaveLength(1)
    expect(overflow.matches[0].quantity).toBe(999)
    expect(overflow.errors[0]).toContain('acima de 999')
  })
})
