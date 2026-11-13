export interface SkuLine {
  line: number
  raw: string
  sku: string
  quantity: number | null
  error: string | null
}

export interface SkuProduct {
  id: string
  name: string
  unit: string
  price_cents: number | null
  sku: string | null
}

export interface SkuMatch {
  product: SkuProduct
  quantity: number
}

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,31}$/

export function parseSkuList(input: string): SkuLine[] {
  const lines: SkuLine[] = []

  input.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const parts = trimmed.split(/[\s,;]+/).filter(Boolean)
    const sku = (parts[0] ?? '').toUpperCase()
    const quantityRaw = parts[1]

    let error: string | null = null
    let quantity: number | null = null

    if (!SKU_PATTERN.test(sku)) {
      error = 'SKU inválido'
    } else if (!quantityRaw || !/^\d{1,3}$/.test(quantityRaw)) {
      error = 'Quantidade inválida'
    } else {
      quantity = Number(quantityRaw)
      if (quantity < 1 || quantity > 999) {
        error = 'Quantidade deve ficar entre 1 e 999'
      }
    }

    lines.push({ line: index + 1, raw: trimmed, sku, quantity, error })
  })

  return lines
}

export function resolveSkuLines(
  lines: SkuLine[],
  products: SkuProduct[],
): { matches: SkuMatch[]; errors: string[] } {
  const bySku = new Map<string, SkuProduct>()
  for (const product of products) {
    if (product.sku) bySku.set(product.sku.toUpperCase(), product)
  }

  const aggregated = new Map<string, SkuMatch>()
  const errors: string[] = []

  for (const line of lines) {
    if (line.error) {
      errors.push(`Linha ${line.line}: ${line.error}`)
      continue
    }
    const product = bySku.get(line.sku)
    if (!product) {
      errors.push(`Linha ${line.line}: SKU ${line.sku} não encontrado`)
      continue
    }

    const current = aggregated.get(product.id)?.quantity ?? 0
    const next = current + (line.quantity ?? 0)
    if (next > 999) {
      errors.push(`Linha ${line.line}: quantidade agregada acima de 999`)
      continue
    }
    aggregated.set(product.id, { product, quantity: next })
  }

  return { matches: [...aggregated.values()], errors }
}
