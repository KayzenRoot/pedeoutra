import { describe, expect, it } from 'vitest'
import { CATALOG_TEMPLATES, findCatalogTemplate } from './onboarding-templates.ts'

describe('templates de catálogo', () => {
  it('oferece cinco modelos, incluindo catálogo vazio', () => {
    expect(CATALOG_TEMPLATES).toHaveLength(5)
    expect(CATALOG_TEMPLATES.map((template) => template.code)).toEqual([
      'packaging',
      'cleaning',
      'water_ice',
      'groceries',
      'empty',
    ])
    expect(findCatalogTemplate('empty', 1)?.items).toEqual([])
  })

  it('tem chaves únicas e campos obrigatórios em todos os itens', () => {
    for (const template of CATALOG_TEMPLATES) {
      const keys = template.items.map((item) => item.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const item of template.items) {
        expect(item.name.trim().length).toBeGreaterThan(2)
        expect(item.category.trim().length).toBeGreaterThan(1)
        expect(item.unit.trim().length).toBeGreaterThan(0)
        expect(item.min_quantity).toBeGreaterThan(0)
        expect(item.quantity_increment).toBeGreaterThan(0)
        expect(item.min_quantity % item.quantity_increment).toBe(0)
      }
    }
  })

  it('não carrega preço, estoque ou disponibilidade nos modelos', () => {
    for (const template of CATALOG_TEMPLATES) {
      for (const item of template.items) {
        expect(item).not.toHaveProperty('price_cents')
        expect(item).not.toHaveProperty('stock')
        expect(item).not.toHaveProperty('available')
      }
    }
  })

  it('rejeita versão inexistente', () => {
    expect(findCatalogTemplate('packaging', 99)).toBeNull()
    expect(findCatalogTemplate('desconhecido', 1)).toBeNull()
  })
})
