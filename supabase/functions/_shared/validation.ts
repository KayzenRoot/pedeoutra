/**
 * Validação pura de payloads públicos. Sem dependências de Deno, para ser
 * testável em Node/Vitest e reutilizável pelas Edge Functions.
 */
export const MAX_ITEMS = 50
export const MAX_QUANTITY = 999
export const MAX_NOTE_LENGTH = 500
export const MIN_ELAPSED_MS = 800
export const MAX_BODY_BYTES = 100_000

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface OrderItemInput {
  product_id: string
  quantity: number
}

export interface PublicOrderInput {
  slug: string
  buyerName: string
  buyerPhone: string
  note: string | null
  items: OrderItemInput[]
  requestId: string
}

export interface ReorderOrderInput {
  items: OrderItemInput[]
  requestId: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length === 0) return null
  return cleaned.slice(0, maxLength)
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return digits
}

function validateItems(value: unknown): ValidationResult<OrderItemInput[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) {
    return { ok: false, error: 'invalid_items' }
  }

  const items: OrderItemInput[] = []
  const seen = new Set<string>()

  for (const raw of value) {
    if (!isRecord(raw)) return { ok: false, error: 'invalid_items' }
    const productId = typeof raw.product_id === 'string' ? raw.product_id.toLowerCase() : ''
    const quantity = raw.quantity
    if (!UUID_PATTERN.test(productId)) return { ok: false, error: 'invalid_items' }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      return { ok: false, error: 'invalid_items' }
    }
    if (quantity < 1 || quantity > MAX_QUANTITY) return { ok: false, error: 'invalid_items' }
    if (seen.has(productId)) return { ok: false, error: 'duplicate_items' }
    seen.add(productId)
    items.push({ product_id: productId, quantity })
  }

  return { ok: true, value: items }
}

interface AntiSpamFields {
  honeypot: string
  elapsedMs: number
  consent: boolean
  requestId: string
}

function validateCommonFields(input: Record<string, unknown>): ValidationResult<AntiSpamFields> {
  const honeypot = input.company_website
  if (honeypot !== undefined && honeypot !== null && honeypot !== '') {
    return { ok: false, error: 'spam_detected' }
  }

  const elapsedMs = input.elapsed_ms
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) {
    return { ok: false, error: 'invalid_elapsed' }
  }
  if (elapsedMs < MIN_ELAPSED_MS) return { ok: false, error: 'spam_detected' }

  const requestId = input.request_id
  if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
    return { ok: false, error: 'invalid_request_id' }
  }

  return {
    ok: true,
    value: {
      honeypot: '',
      elapsedMs,
      consent: input.consent === true,
      requestId: requestId.toLowerCase(),
    },
  }
}

export function parsePublicOrderInput(input: unknown): ValidationResult<PublicOrderInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }

  const common = validateCommonFields(input)
  if (!common.ok) return common
  if (!common.value.consent) return { ok: false, error: 'consent_required' }

  const slug = typeof input.slug === 'string' ? input.slug.trim() : ''
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, error: 'invalid_slug' }
  }

  const buyerName = cleanText(input.buyer_name, 120)
  if (!buyerName || buyerName.length < 2) return { ok: false, error: 'invalid_buyer_name' }

  const buyerPhone = normalizePhone(input.buyer_phone)
  if (!buyerPhone) return { ok: false, error: 'invalid_buyer_phone' }

  const note = cleanText(input.note, MAX_NOTE_LENGTH)
  if (typeof input.note === 'string' && input.note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: 'invalid_note' }
  }

  const items = validateItems(input.items)
  if (!items.ok) return items

  return {
    ok: true,
    value: {
      slug,
      buyerName,
      buyerPhone,
      note,
      items: items.value,
      requestId: common.value.requestId,
    },
  }
}

export function parseReorderInput(input: unknown): ValidationResult<ReorderOrderInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }

  const common = validateCommonFields(input)
  if (!common.ok) return common

  const items = validateItems(input.items)
  if (!items.ok) return items

  return {
    ok: true,
    value: {
      items: items.value,
      requestId: common.value.requestId,
    },
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
