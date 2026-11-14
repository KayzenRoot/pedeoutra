/**
 * Validação pura de payloads públicos. Sem dependências de Deno, para ser
 * testável em Node/Vitest e reutilizável pelas Edge Functions.
 */
import { OPAQUE_TOKEN_PATTERN } from './tokens.ts'

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
  buyerName: string | null
  buyerPhone: string | null
  note: string | null
  items: OrderItemInput[]
  requestId: string
  priceToken: string | null
  whatsappUpdates: boolean
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

export function isValidSlug(value: string): boolean {
  if (value.length < 1 || value.length > 120) return false
  return value.split('-').every((part) => /^[a-z0-9]+$/.test(part))
}

function parsePriceToken(value: unknown): ValidationResult<string | null> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null }
  }
  if (typeof value !== 'string' || !OPAQUE_TOKEN_PATTERN.test(value)) {
    return { ok: false, error: 'invalid_price_token' }
  }
  return { ok: true, value }
}

function parseBuyer(
  input: Record<string, unknown>,
  priceToken: string | null,
): ValidationResult<{ buyerName: string | null; buyerPhone: string | null }> {
  if (priceToken) {
    // O token identifica o comprador; nome/telefone são ignorados e não persistidos.
    return { ok: true, value: { buyerName: null, buyerPhone: null } }
  }
  const buyerName = cleanText(input.buyer_name, 120)
  if (!buyerName || buyerName.length < 2) {
    return { ok: false, error: 'invalid_buyer_name' }
  }
  const buyerPhone = normalizePhone(input.buyer_phone)
  if (!buyerPhone) return { ok: false, error: 'invalid_buyer_phone' }
  return { ok: true, value: { buyerName, buyerPhone } }
}

export function parsePublicOrderInput(input: unknown): ValidationResult<PublicOrderInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }

  const common = validateCommonFields(input)
  if (!common.ok) return common
  if (!common.value.consent) return { ok: false, error: 'consent_required' }

  const slug = typeof input.slug === 'string' ? input.slug.trim() : ''
  if (!isValidSlug(slug)) return { ok: false, error: 'invalid_slug' }

  const priceTokenResult = parsePriceToken(input.price_token)
  if (!priceTokenResult.ok) return priceTokenResult
  const buyerResult = parseBuyer(input, priceTokenResult.value)
  if (!buyerResult.ok) return buyerResult
  const { buyerName, buyerPhone } = buyerResult.value

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
      priceToken: priceTokenResult.value,
      whatsappUpdates: input.whatsapp_updates === true,
    },
  }
}

export interface QuoteSaveInput {
  items: OrderItemInput[]
  validUntil: string
  notes: string | null
}

export interface QuoteCreateInput extends QuoteSaveInput {
  customerId: string
}

export interface QuoteUpdateInput extends QuoteSaveInput {
  quoteId: string
  expectedVersion: number
}

export interface QuoteActionInput {
  quoteId: string
  expectedVersion: number
}

export interface QuoteAcceptInput {
  token: string
  requestId: string
}

export interface QuoteDeclineInput {
  token: string
}

function parseQuoteBase(
  input: Record<string, unknown>,
): ValidationResult<QuoteSaveInput> {
  const items = validateItems(input.items)
  if (!items.ok) return items

  const validUntil = input.valid_until
  if (typeof validUntil !== 'string' || !Number.isFinite(Date.parse(validUntil))) {
    return { ok: false, error: 'invalid_quote_validity' }
  }

  const notes = cleanText(input.notes, 1000)
  if (typeof input.notes === 'string' && input.notes.length > 1000) {
    return { ok: false, error: 'invalid_quote_notes' }
  }

  return { ok: true, value: { items: items.value, validUntil, notes } }
}

function parseQuoteId(value: unknown): string | null {
  return isUuid(value) ? value : null
}

function parseExpectedVersion(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null
  return value
}

export function parseQuoteCreateInput(input: unknown): ValidationResult<QuoteCreateInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  const customerId = parseQuoteId(input.customer_id)
  if (!customerId) return { ok: false, error: 'invalid_customer' }
  const base = parseQuoteBase(input)
  if (!base.ok) return base
  return { ok: true, value: { ...base.value, customerId } }
}

export interface TeamInviteInput {
  email: string
  role: 'manager' | 'operator' | 'viewer'
}

export interface TeamAcceptInput {
  token: string
}

export interface TeamRoleInput {
  membershipId: string
  role: 'manager' | 'operator' | 'viewer'
}

export interface TeamRevokeInput {
  membershipId: string | null
  invitationId: string | null
}

const TEAM_ROLES = new Set(['manager', 'operator', 'viewer'])

function isValidTeamEmail(email: string): boolean {
  if (email.length < 3 || email.length > 254) return false
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@')) return false
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (!local || /\s/.test(local)) return false
  const labels = domain.split('.')
  return labels.length >= 2 && labels.every((label) => label.length > 0 && !/\s/.test(label))
}

export function parseTeamInviteInput(input: unknown): ValidationResult<TeamInviteInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!isValidTeamEmail(email)) {
    return { ok: false, error: 'invalid_email' }
  }
  if (typeof input.role !== 'string' || !TEAM_ROLES.has(input.role)) {
    return { ok: false, error: 'invalid_role' }
  }
  return { ok: true, value: { email, role: input.role as TeamInviteInput['role'] } }
}

export function parseTeamAcceptInput(input: unknown): ValidationResult<TeamAcceptInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  if (typeof input.token !== 'string' || !OPAQUE_TOKEN_PATTERN.test(input.token)) {
    return { ok: false, error: 'invalid_invitation_token' }
  }
  return { ok: true, value: { token: input.token } }
}

export function parseTeamRoleInput(input: unknown): ValidationResult<TeamRoleInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  if (!isUuid(input.membership_id)) return { ok: false, error: 'invalid_member' }
  if (typeof input.role !== 'string' || !TEAM_ROLES.has(input.role)) {
    return { ok: false, error: 'invalid_role' }
  }
  return {
    ok: true,
    value: { membershipId: input.membership_id, role: input.role as TeamRoleInput['role'] },
  }
}

export function parseTeamRevokeInput(input: unknown): ValidationResult<TeamRevokeInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  const membershipId = isUuid(input.membership_id) ? input.membership_id : null
  const invitationId = isUuid(input.invitation_id) ? input.invitation_id : null
  if ((membershipId === null) === (invitationId === null)) {
    return { ok: false, error: 'invalid_revoke_target' }
  }
  return { ok: true, value: { membershipId, invitationId } }
}

export function parseQuoteSaveInput(input: unknown): ValidationResult<QuoteSaveInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  return parseQuoteBase(input)
}

export function parseQuoteUpdateInput(input: unknown): ValidationResult<QuoteUpdateInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  const quoteId = parseQuoteId(input.quote_id)
  if (!quoteId) return { ok: false, error: 'invalid_quote' }
  const expectedVersion = parseExpectedVersion(input.expected_version)
  if (expectedVersion === null) return { ok: false, error: 'invalid_version' }
  const base = parseQuoteBase(input)
  if (!base.ok) return base
  return { ok: true, value: { ...base.value, quoteId, expectedVersion } }
}

export function parseQuoteActionInput(input: unknown): ValidationResult<QuoteActionInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  const quoteId = parseQuoteId(input.quote_id)
  if (!quoteId) return { ok: false, error: 'invalid_quote' }
  const expectedVersion = parseExpectedVersion(input.expected_version)
  if (expectedVersion === null) return { ok: false, error: 'invalid_version' }
  return { ok: true, value: { quoteId, expectedVersion } }
}

export function parseQuoteAcceptInput(input: unknown): ValidationResult<QuoteAcceptInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  const common = validateCommonFields(input)
  if (!common.ok) return common
  if (input.confirm !== true) return { ok: false, error: 'confirm_required' }
  if (typeof input.token !== 'string' || !OPAQUE_TOKEN_PATTERN.test(input.token)) {
    return { ok: false, error: 'invalid_quote_token' }
  }
  return {
    ok: true,
    value: { token: input.token, requestId: common.value.requestId },
  }
}

export function parseQuoteDeclineInput(input: unknown): ValidationResult<QuoteDeclineInput> {
  if (!isRecord(input)) return { ok: false, error: 'invalid_body' }
  if (input.confirm !== true) return { ok: false, error: 'confirm_required' }
  if (typeof input.token !== 'string' || !OPAQUE_TOKEN_PATTERN.test(input.token)) {
    return { ok: false, error: 'invalid_quote_token' }
  }
  return { ok: true, value: { token: input.token } }
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
