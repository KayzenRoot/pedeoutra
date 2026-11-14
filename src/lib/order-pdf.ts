import { formatBRL, formatDateTime, statusLabel } from './format'

export interface OrderReceiptItem {
  name: string
  unit?: string | null
  quantity: number
  unitPriceCents?: number | null
  subtotalCents?: number | null
}

export interface OrderReceiptInput {
  organizationName: string
  reference: string
  createdAt: string
  status: string
  items: OrderReceiptItem[]
  totalCents: number | null
  buyerName?: string | null
  buyerPhone?: string | null
  includeBuyer?: boolean
  includePrices?: boolean
  documentTitle?: string
  note?: string | null
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 48
const FOOTER_SPACE = 44
const LINE_HEIGHT = 12

function toLatin1(value: string): string {
  const normalized = value
    .replaceAll('\u00a0', ' ')
    .replaceAll('\u2013', '-')
    .replaceAll('\u2014', '-')
    .replaceAll('\u2018', "'")
    .replaceAll('\u2019', "'")
    .replaceAll('\u201c', '"')
    .replaceAll('\u201d', '"')
  let result = ''
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0
    if (code === 10 || code === 13) result += ' '
    else if (code <= 255) result += char
    else result += '?'
  }
  return result
}

function pdfString(value: string): string {
  const escaped = toLatin1(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
  return `(${escaped})`
}

function textCommand(
  x: number,
  y: number,
  size: number,
  value: string,
  bold = false,
): string {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(value)} Tj ET`
}

function lineCommand(x1: number, y1: number, x2: number, y2: number): string {
  return `q 0.72 G 0.6 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`
}

function wrapText(value: string, maxChars: number): string[] {
  const words = toLatin1(value).split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) lines.push(current)
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars))
      }
      current = ''
      continue
    }
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  return lines
}

function formatDateTimeSafe(value: string): string {
  return formatDateTime(value)
}

function buildPages(input: OrderReceiptInput): string[] {
  const pages: string[][] = []
  let commands: string[] = []
  let y = PAGE_HEIGHT - MARGIN
  const includePrices = input.includePrices !== false
  const includeBuyer = input.includeBuyer === true

  function startPage() {
    if (commands.length > 0) pages.push(commands)
    commands = []
    y = PAGE_HEIGHT - MARGIN
  }

  function ensureSpace(height: number) {
    if (y - height < MARGIN + FOOTER_SPACE) startPage()
  }

  function drawTableHeader() {
    ensureSpace(28)
    commands.push(textCommand(MARGIN, y, 9, 'Item', true))
    if (includePrices) {
      commands.push(textCommand(MARGIN + 300, y, 9, 'Qtd.', true))
      commands.push(textCommand(MARGIN + 348, y, 9, 'Preço', true))
      commands.push(textCommand(MARGIN + 446, y, 9, 'Subtotal', true))
    } else {
      commands.push(textCommand(MARGIN + 430, y, 9, 'Qtd.', true))
    }
    y -= 6
    commands.push(lineCommand(MARGIN, y, PAGE_WIDTH - MARGIN, y))
    y -= 14
  }

  function drawFooter(pageNumber: number, pageCount: number) {
    const footerY = MARGIN - 14
    commands.push(
      lineCommand(MARGIN, MARGIN + 6, PAGE_WIDTH - MARGIN, MARGIN + 6),
    )
    commands.push(
      textCommand(
        MARGIN,
        footerY,
        8,
        'Comprovante de pedido, não é documento fiscal nem prova de pagamento.',
      ),
    )
    commands.push(
      textCommand(
        PAGE_WIDTH - MARGIN - 74,
        footerY,
        8,
        `Página ${pageNumber} de ${pageCount}`,
      ),
    )
  }

  const title = input.documentTitle ?? 'Comprovante de pedido'
  commands.push(textCommand(MARGIN, y, 17, input.organizationName, true))
  y -= 24
  commands.push(textCommand(MARGIN, y, 14, title, true))
  y -= 22
  commands.push(textCommand(MARGIN, y, 11, `Referência: ${input.reference}`, true))
  y -= 16
  commands.push(
    textCommand(
      MARGIN,
      y,
      9,
      `Emitido em: ${formatDateTimeSafe(input.createdAt)}   Status: ${statusLabel(input.status)}`,
    ),
  )
  y -= 8
  commands.push(lineCommand(MARGIN, y, PAGE_WIDTH - MARGIN, y))
  y -= 22

  if (includeBuyer) {
    const buyer = input.buyerName?.trim()
    const phone = input.buyerPhone?.trim()
    if (buyer) {
      commands.push(textCommand(MARGIN, y, 10, `Comprador: ${buyer}`, true))
      y -= 15
    }
    if (phone) {
      commands.push(textCommand(MARGIN, y, 9, `Telefone: ${phone}`))
      y -= 15
    }
    if (buyer || phone) {
      y -= 4
    }
  }

  drawTableHeader()

  for (const item of input.items) {
    const label = item.unit ? `${item.name} (${item.unit})` : item.name
    const lines = wrapText(label, includePrices ? 46 : 62)
    const rowHeight = Math.max(1, lines.length) * LINE_HEIGHT + 5
    if (y - rowHeight < MARGIN + FOOTER_SPACE) {
      startPage()
      drawTableHeader()
    }
    for (const [index, line] of lines.entries()) {
      commands.push(textCommand(MARGIN, y - index * LINE_HEIGHT, 9, line))
    }
    if (includePrices) {
      commands.push(textCommand(MARGIN + 300, y, 9, String(item.quantity)))
      commands.push(
        textCommand(
          MARGIN + 348,
          y,
          9,
          item.unitPriceCents === null || item.unitPriceCents === undefined
            ? '—'
            : formatBRL(item.unitPriceCents),
        ),
      )
      commands.push(
        textCommand(
          MARGIN + 446,
          y,
          9,
          item.subtotalCents === null || item.subtotalCents === undefined
            ? '—'
            : formatBRL(item.subtotalCents),
        ),
      )
    } else {
      commands.push(textCommand(MARGIN + 430, y, 9, String(item.quantity)))
    }
    y -= rowHeight
    commands.push(lineCommand(MARGIN, y + 3, PAGE_WIDTH - MARGIN, y + 3))
  }

  ensureSpace(50)
  y -= 4
  commands.push(lineCommand(MARGIN, y, PAGE_WIDTH - MARGIN, y))
  y -= 20
  commands.push(textCommand(MARGIN + 300, y, 10, 'Total do pedido', true))
  commands.push(textCommand(MARGIN + 430, y, 12, formatBRL(input.totalCents), true))
  y -= 22

  if (input.note?.trim()) {
    ensureSpace(60)
    commands.push(textCommand(MARGIN, y, 9, 'Observação:', true))
    y -= 14
    for (const line of wrapText(input.note, 82)) {
      ensureSpace(LINE_HEIGHT)
      commands.push(textCommand(MARGIN, y, 9, line))
      y -= LINE_HEIGHT
    }
  }

  pages.push(commands)
  return pages.map((pageCommands, index) => {
    const footer: string[] = []
    const original = commands
    commands = footer
    drawFooter(index + 1, pages.length)
    commands = original
    return [...pageCommands, ...footer].join('\n')
  })
}

function byteLength(value: string): number {
  return value.length
}

export function createOrderReceiptPdf(input: OrderReceiptInput): Uint8Array {
  const streams = buildPages(input)
  const objects: string[] = []
  const pageIds: number[] = []
  const contentIds: number[] = []

  // 1 catálogo, 2 páginas, 3 fonte regular, 4 fonte negrito.
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('')
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  )
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  )

  for (const stream of streams) {
    const contentId = objects.length + 1
    contentIds.push(contentId)
    objects.push(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`)
    const pageId = objects.length + 1
    pageIds.push(pageId)
    objects.push('')
  }

  for (const [index, pageId] of pageIds.entries()) {
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentIds[index]} 0 R >>`
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let pdf = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'
  const offsets: number[] = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  const bytes = new Uint8Array(pdf.length)
  for (let index = 0; index < pdf.length; index += 1) {
    bytes[index] = pdf.charCodeAt(index) & 0xff
  }
  return bytes
}

export function orderReceiptFilename(reference: string, includeBuyer: boolean): string {
  const safe = reference.replace(/[^A-Za-z0-9-]/g, '').slice(0, 48) || 'pedido'
  return `comprovante-${safe}${includeBuyer ? '' : '-sem-pii'}.pdf`
}

export function downloadOrderReceipt(input: OrderReceiptInput): void {
  const bytes = createOrderReceiptPdf(input)
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = orderReceiptFilename(input.reference, input.includeBuyer === true)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function printOrderReceipt(input: OrderReceiptInput): boolean {
  const bytes = createOrderReceiptPdf(input)
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank')
  if (!opened) {
    URL.revokeObjectURL(url)
    return false
  }
  window.setTimeout(() => {
    try {
      opened.print()
    } catch {
      // O leitor decide se permite imprimir; o download continua disponível.
    }
  }, 500)
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  return true
}
