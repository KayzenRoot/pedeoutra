export const MAX_IMPORT_ROWS = 500

export type ImportAction = 'auto' | 'create' | 'update' | 'ignore'
export type ImportPlanAction = 'create' | 'update' | 'ignore' | 'error'

export interface ImportProductRef {
  id: string
  sku: string | null
}

export interface ImportCategoryRef {
  id: string
  name: string
}

export interface ImportPlanRow {
  line: number
  action: ImportPlanAction
  error: string | null
  name: string
  sku: string | null
  category: string | null
  category_new: boolean
  unit: string
  price_cents: number | null
  active: boolean
  min_quantity: number
  quantity_increment: number
  product_id: string | null
}

export interface ImportPlan {
  rows: ImportPlanRow[]
  errors: number
  creates: number
  updates: number
  ignores: number
}

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,31}$/
const FORMULA_PATTERN = /^[=+@]/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function intValue(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === '') return fallback
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numeric)) return null
  return numeric
}

function priceValue(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numeric)) return undefined
  if (numeric < 0 || numeric > 1_000_000) return undefined
  return numeric
}

function boolValue(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return true
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 'sim' || value === '1') return true
  if (value === 'false' || value === 'nao' || value === 'não' || value === '0') return false
  return null
}

interface ParsedRow {
  line: number
  name: string
  sku: string | null
  category: string | null
  unit: string
  price: number | null
  active: boolean
  minQuantity: number
  quantityIncrement: number
  action: ImportAction | 'invalid'
  errors: string[]
}

function parseRow(raw: unknown, index: number): ParsedRow {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const line = intValue(row.line, index + 1)
  const name = text(row.name)
  const rawSku = text(row.sku).toUpperCase()
  const sku = rawSku || null
  const category = text(row.category) || null
  const unit = text(row.unit)
  const price = priceValue(row.price_cents)
  const active = boolValue(row.active)
  const minQuantity = intValue(row.min_quantity, 1)
  const quantityIncrement = intValue(row.quantity_increment, 1)
  const rawAction = text(row.action).toLowerCase() || 'auto'
  const action = (['auto', 'create', 'update', 'ignore'].includes(rawAction)
    ? rawAction
    : 'invalid') as ImportAction | 'invalid'
  const errors: string[] = []

  if (line === null || line < 1 || line > 10000) errors.push('Linha inválida')
  if (!name || name.length > 120 || /[<>]/.test(name) || FORMULA_PATTERN.test(name)) {
    errors.push('Nome inválido')
  }
  if (sku && (!SKU_PATTERN.test(sku) || FORMULA_PATTERN.test(sku))) {
    errors.push('SKU inválido')
  }
  if (category && (category.length > 80 || /[<>]/.test(category) || FORMULA_PATTERN.test(category))) {
    errors.push('Categoria inválida')
  }
  if (!unit || unit.length > 20 || /[<>]/.test(unit) || FORMULA_PATTERN.test(unit)) {
    errors.push('Unidade inválida')
  }
  if (price === undefined) errors.push('Preço inválido')
  if (active === null) errors.push('Ativo inválido')
  if (
    minQuantity === null ||
    quantityIncrement === null ||
    minQuantity < 1 ||
    minQuantity > 999 ||
    quantityIncrement < 1 ||
    quantityIncrement > 999 ||
    minQuantity % quantityIncrement !== 0
  ) {
    errors.push('Regra de quantidade inválida')
  }
  if (action === 'invalid') errors.push('Ação inválida')

  return {
    line: line ?? index + 1,
    name,
    sku,
    category,
    unit,
    price: price === undefined ? null : price,
    active: active ?? true,
    minQuantity: minQuantity ?? 1,
    quantityIncrement: quantityIncrement ?? 1,
    action,
    errors,
  }
}

function resolveAction(
  action: ImportAction | 'invalid',
  sku: string | null,
  existing: ImportProductRef | undefined,
  errors: string[],
): ImportPlanAction {
  if (action === 'ignore') return 'ignore'
  if (action === 'create' && existing) {
    errors.push('SKU já existe; use update ou ignore')
    return 'error'
  }
  if (action === 'update' && !existing) {
    errors.push('SKU não encontrado para atualização')
    return 'error'
  }
  if (action === 'update' && !sku) {
    errors.push('Update exige SKU')
    return 'error'
  }
  if (action === 'auto') return existing ? 'update' : 'create'
  return action === 'update' ? 'update' : 'create'
}

function validateRow(
  raw: unknown,
  index: number,
  productsBySku: Map<string, ImportProductRef>,
  categoriesByName: Map<string, ImportCategoryRef>,
  seenSkus: Set<string>,
): ImportPlanRow {
  const parsed = parseRow(raw, index)
  if (parsed.sku && parsed.action !== 'ignore') {
    if (seenSkus.has(parsed.sku)) parsed.errors.push('SKU duplicado no arquivo')
    seenSkus.add(parsed.sku)
  }

  const existing = parsed.sku ? productsBySku.get(parsed.sku) : undefined
  const action = resolveAction(parsed.action, parsed.sku, existing, parsed.errors)
  const finalAction: ImportPlanAction = parsed.errors.length > 0 ? 'error' : action

  return {
    line: parsed.line,
    action: finalAction,
    error: parsed.errors.length > 0 ? parsed.errors.join('; ') : null,
    name: parsed.name,
    sku: parsed.sku,
    category: parsed.category,
    category_new: Boolean(
      parsed.category && !categoriesByName.has(parsed.category.toLowerCase()),
    ),
    unit: parsed.unit,
    price_cents: parsed.price,
    active: parsed.active,
    min_quantity: parsed.minQuantity,
    quantity_increment: parsed.quantityIncrement,
    product_id: existing?.id ?? null,
  }
}

export function planImportRows(
  inputRows: unknown[],
  products: ImportProductRef[],
  categories: ImportCategoryRef[],
): ImportPlan {
  const productsBySku = new Map<string, ImportProductRef>()
  for (const product of products) {
    if (product.sku) productsBySku.set(product.sku.toUpperCase(), product)
  }
  const categoriesByName = new Map<string, ImportCategoryRef>()
  for (const category of categories) {
    categoriesByName.set(category.name.toLowerCase(), category)
  }

  const seenSkus = new Set<string>()
  const rows = inputRows.map((row, index) =>
    validateRow(row, index, productsBySku, categoriesByName, seenSkus),
  )

  return {
    rows,
    errors: rows.filter((row) => row.action === 'error').length,
    creates: rows.filter((row) => row.action === 'create').length,
    updates: rows.filter((row) => row.action === 'update').length,
    ignores: rows.filter((row) => row.action === 'ignore').length,
  }
}
