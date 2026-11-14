import { describe, expect, it } from 'vitest'
import { planImportRows } from './import.ts'

const products = [
  { id: 'p1', sku: 'COPO-200' },
  { id: 'p2', sku: 'AGUA-5L' },
]
const categories = [{ id: 'c1', name: 'Bebidas' }]

describe('planejamento de importação', () => {
  it('cria, atualiza e ignora por SKU', () => {
    const plan = planImportRows(
      [
        { line: 2, name: 'Copo novo', sku: 'copo-200', unit: 'cento', price_cents: 1300 },
        { line: 3, name: 'Novo', sku: 'NOVO-1', unit: 'un', price_cents: 500 },
        { line: 4, name: 'Ignorar', sku: 'AGUA-5L', unit: 'galão', action: 'ignore' },
      ],
      products,
      categories,
    )
    expect(plan.rows.map((row) => row.action)).toEqual(['update', 'create', 'ignore'])
    expect(plan.errors).toBe(0)
    expect(plan.rows[0].product_id).toBe('p1')
    expect(plan.rows[1].sku).toBe('NOVO-1')
  })

  it('detecta duplicidade no arquivo, SKU inexistente e campos inválidos', () => {
    const plan = planImportRows(
      [
        { line: 2, name: 'A', sku: 'NOVO-1', unit: 'un' },
        { line: 3, name: 'B', sku: 'NOVO-1', unit: 'un' },
        { line: 4, name: 'C', sku: 'FALTA', unit: 'un', action: 'update' },
        { line: 5, name: '<script>', unit: 'un' },
      ],
      products,
      categories,
    )
    expect(plan.rows[1].error).toContain('duplicado')
    expect(plan.rows[2].error).toContain('não encontrado')
    expect(plan.rows[3].error).toContain('Nome inválido')
    expect(plan.errors).toBe(3)
  })

  it('marca categoria nova e valida múltiplo', () => {
    const plan = planImportRows(
      [
        {
          line: 2,
          name: 'Copo',
          sku: 'COPO-200',
          unit: 'cento',
          category: 'Descartáveis',
          min_quantity: 12,
          quantity_increment: 12,
        },
        {
          line: 3,
          name: 'Água',
          sku: 'AGUA-5L',
          unit: 'galão',
          min_quantity: 6,
          quantity_increment: 12,
        },
      ],
      products,
      categories,
    )
    expect(plan.rows[0].category_new).toBe(true)
    expect(plan.rows[1].error).toContain('Regra de quantidade inválida')
  })

  it('rejeita fórmula em texto e preço fora do limite', () => {
    const plan = planImportRows(
      [
        { line: 2, name: '=HYPERLINK("x")', unit: 'un' },
        { line: 3, name: 'Produto', unit: 'un', price_cents: 1000001 },
      ],
      products,
      categories,
    )
    expect(plan.rows[0].error).toContain('Nome inválido')
    expect(plan.rows[1].error).toContain('Preço inválido')
  })
})
