export const MAX_IMPORT_ROWS = 500
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

export interface ImportRowInput {
  line: number
  name: string
  sku: string | null
  category: string | null
  unit: string
  price_cents: number | string | null
  active: boolean | string
  min_quantity: number | string
  quantity_increment: number | string
  action: string
}

export interface ParsedImportFile {
  rows: ImportRowInput[]
  rowCount: number
}

const HEADER_ALIASES: Record<string, string> = {
  nome: 'name',
  name: 'name',
  produto: 'name',
  descricao: 'name',
  sku: 'sku',
  codigo: 'sku',
  code: 'sku',
  categoria: 'category',
  category: 'category',
  grupo: 'category',
  unidade: 'unit',
  unit: 'unit',
  embalagem: 'unit',
  preco: 'price_cents',
  price: 'price_cents',
  valor: 'price_cents',
  ativo: 'active',
  active: 'active',
  quantidademinima: 'min_quantity',
  qtdminima: 'min_quantity',
  minimo: 'min_quantity',
  min_quantity: 'min_quantity',
  multiplo: 'quantity_increment',
  multiplodeembalagem: 'quantity_increment',
  incremento: 'quantity_increment',
  quantity_increment: 'quantity_increment',
  acao: 'action',
  action: 'action',
}

function cellText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  return ''
}

function normalizeHeader(value: unknown): string {
  return cellText(value)
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/g, '')
}

function detectDelimiter(text: string): ',' | ';' {
  let commas = 0
  let semicolons = 0
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (!quoted && char === '\n') {
      break
    } else if (!quoted && char === ',') {
      commas += 1
    } else if (!quoted && char === ';') {
      semicolons += 1
    }
  }
  return semicolons > commas ? ';' : ','
}

export function parseCsv(text: string): string[][] { // NOSONAR: parser de estado linear, coberto por testes de CSV. // NOSONAR: parser de estado linear, coberto por testes de CSV.
  const input = text.replace(/^\uFEFF/, '')
  const delimiter = detectDelimiter(input)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (quoted) throw new Error('CSV inválido: aspas não fechadas.')
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((line) => line.some((cell) => cell.trim() !== ''))
}

export function parsePriceCents(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    const cents = Math.round(value * 100)
    return cents >= 0 && cents <= 1_000_000 ? cents : undefined
  }

  const raw = cellText(value)
    .replaceAll(/R\$/gi, '')
    .replaceAll(/\s/g, '')
    .replaceAll('\u00a0', '')
  if (!raw) return null
  const normalized = raw.includes(',')
    ? raw.replaceAll('.', '').replace(',', '.')
    : raw
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return undefined
  const cents = Math.round(numeric * 100)
  return cents >= 0 && cents <= 1_000_000 ? cents : undefined
}

function parseInteger(value: unknown): number | string {
  if (value === null || value === undefined || value === '') return 1
  if (typeof value === 'number' && Number.isInteger(value)) return value
  const text = cellText(value).trim()
  if (!/^\d{1,3}$/.test(text)) return text
  return Number(text)
}

function parseActive(value: unknown): boolean | string {
  if (value === null || value === undefined || value === '') return true
  if (typeof value === 'boolean') return value
  const text = cellText(value).trim().toLowerCase()
  if (['sim', 'true', '1', 'ativo'].includes(text)) return true
  if (['nao', 'não', 'false', '0', 'inativo'].includes(text)) return false
  return text
}

export function rowsFromMatrix(matrix: unknown[][]): ParsedImportFile {
  if (matrix.length < 2) throw new Error('A planilha precisa de cabeçalho e ao menos uma linha.')
  if (matrix.length - 1 > MAX_IMPORT_ROWS) {
    throw new Error(`Envie no máximo ${MAX_IMPORT_ROWS} linhas por arquivo.`)
  }

  const headerMap = new Map<string, number>()
  matrix[0].forEach((header, index) => {
    const field = HEADER_ALIASES[normalizeHeader(header)]
    if (field) headerMap.set(field, index)
  })
  if (!headerMap.has('name') || !headerMap.has('unit')) {
    throw new Error('Cabeçalho inválido: inclua ao menos nome e unidade.')
  }

  const valueAt = (row: unknown[], field: string): unknown => {
    const index = headerMap.get(field)
    return index === undefined ? undefined : row[index]
  }

  const rows: ImportRowInput[] = []
  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index]
    if (!row || row.every((cell) => cellText(cell).trim() === '')) continue

    const price = parsePriceCents(valueAt(row, 'price_cents'))
    rows.push({
      line: index + 1,
      name: cellText(valueAt(row, 'name')).trim(),
      sku: cellText(valueAt(row, 'sku')).trim().toUpperCase() || null,
      category: cellText(valueAt(row, 'category')).trim() || null,
      unit: cellText(valueAt(row, 'unit')).trim(),
      price_cents: price === undefined ? cellText(valueAt(row, 'price_cents')) : price,
      active: parseActive(valueAt(row, 'active')),
      min_quantity: parseInteger(valueAt(row, 'min_quantity')),
      quantity_increment: parseInteger(valueAt(row, 'quantity_increment')),
      action: cellText(valueAt(row, 'action')).trim().toLowerCase() || 'auto',
    })
  }

  if (rows.length === 0) throw new Error('A planilha não tem linhas de dados.')
  return { rows, rowCount: rows.length }
}

export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('O arquivo deve ter no máximo 5 MB.')
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'csv') {
    return rowsFromMatrix(parseCsv(await file.text()))
  }
  if (extension === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser')
    const matrix = (await readSheet(file)) as unknown[][]
    return rowsFromMatrix(matrix)
  }
  if (extension === 'xls' || extension === 'xlsm') {
    throw new Error('Formato não aceito. Use CSV ou XLSX sem macros.')
  }
  throw new Error('Formato não aceito. Envie um arquivo CSV ou XLSX.')
}

export function importTemplateCsv(): string {
  return [
    'nome,sku,categoria,unidade,preco,ativo,quantidade_minima,multiplo,acao',
    '"Copo descartável 200ml",COPO-200,Descartáveis,cento,12.50,sim,1,1,auto',
    '"Água mineral 5L",AGUA-5L,Bebidas,galão,8.99,sim,1,1,auto',
  ].join('\r\n')
}
