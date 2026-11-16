import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_ROWS,
  importTemplateCsv,
  parseCsv,
  parsePriceCents,
  rowsFromMatrix,
} from './import'

describe('importação CSV/XLSX', () => {
  it('detecta vírgula e ponto-e-vírgula, BOM e aspas', () => {
    const comma = parseCsv('\uFEFFnome,unidade,preco\r\n"Copo, grande",cento,12.50\r\n')
    expect(comma[1]).toEqual(['Copo, grande', 'cento', '12.50'])

    const semicolon = parseCsv('nome;unidade;preco\nCopo;cento;12,50\n')
    expect(semicolon[1]).toEqual(['Copo', 'cento', '12,50'])
  })

  it('mantém quebra de linha dentro de aspas e aspas escapadas', () => {
    const rows = parseCsv('nome,obs\n"Linha 1\nLinha 2","diz ""oi"""\n')
    expect(rows[1][0]).toContain('Linha 1\nLinha 2')
    expect(rows[1][1]).toBe('diz "oi"')
  })

  it('converte preço BRL para centavos', () => {
    expect(parsePriceCents('R$ 12,50')).toBe(1250)
    expect(parsePriceCents('12.50')).toBe(1250)
    expect(parsePriceCents(8.99)).toBe(899)
    expect(parsePriceCents('')).toBeNull()
    expect(parsePriceCents('-1')).toBeUndefined()
    expect(parsePriceCents('abc')).toBeUndefined()
  })

  it('mapeia cabeçalhos, SKU e regras de quantidade', () => {
    const parsed = rowsFromMatrix([
      ['Nome', 'Código', 'Categoria', 'Unidade', 'Preço', 'Ativo', 'Qtd mínima', 'Múltiplo', 'Ação'],
      ['Copo', 'copo-200', 'Descartáveis', 'cento', '12,50', 'sim', '12', '12', 'auto'],
    ])
    expect(parsed.rowCount).toBe(1)
    expect(parsed.rows[0]).toMatchObject({
      line: 2,
      name: 'Copo',
      sku: 'COPO-200',
      category: 'Descartáveis',
      unit: 'cento',
      price_cents: 1250,
      active: true,
      min_quantity: 12,
      quantity_increment: 12,
      action: 'auto',
    })
  })

  it('rejeita cabeçalho ausente e arquivo acima do limite', () => {
    expect(() => rowsFromMatrix([['nome'], ['x']])).toThrow(/Cabeçalho inválido/)
    const tooMany = [['nome', 'unidade'], ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ['x', 'un'])]
    expect(() => rowsFromMatrix(tooMany)).toThrow(/no máximo/)
  })

  it('template tem os cabeçalhos esperados', () => {
    expect(importTemplateCsv()).toContain('nome,sku,categoria,unidade,preco,ativo')
  })
})
