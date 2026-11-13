import type { OrderItem, OrderStatus } from './types'

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

const DATE = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeZone: 'America/Sao_Paulo',
})

export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return 'A combinar'
  return BRL.format(cents / 100)
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date)
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '—'
  const clean = digits.replace(/\D/g, '')
  if (clean.length === 11) return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`
  if (clean.length === 10) return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`
  if (clean.length === 13) {
    return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  }
  return clean
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const digits = phoneDigits(phone ?? '')
  if (digits.length < 10) return null
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return null
  return Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000))
}

export function parsePriceToCents(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let normalized = trimmed.replace(/[^\d.,-]/g, '')
  if (!normalized) return null

  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    normalized = normalized.replace(/\./g, '')
  }

  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Novo',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  canceled: 'Cancelado',
}

const STATUS_TONES: Record<OrderStatus, string> = {
  new: 'info',
  confirmed: 'accent',
  completed: 'success',
  canceled: 'muted',
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as OrderStatus] ?? status
}

export function statusTone(status: string): string {
  return STATUS_TONES[status as OrderStatus] ?? 'muted'
}

export function nextStatuses(status: string): OrderStatus[] {
  if (status === 'new') return ['confirmed', 'canceled']
  if (status === 'confirmed') return ['completed', 'canceled']
  return []
}

export function buildOrderMessage(input: {
  organizationName: string
  reference: string
  items: Pick<OrderItem, 'name_snapshot' | 'quantity' | 'unit_snapshot'>[]
  totalCents: number | null
  orderUrl?: string
}): string {
  const lines = [
    `Olá! Pedido ${input.reference} — ${input.organizationName}`,
    '',
    ...input.items.map(
      (item) => `• ${item.quantity}x ${item.name_snapshot} (${item.unit_snapshot})`,
    ),
    '',
    `Total: ${formatBRL(input.totalCents)}`,
  ]
  if (input.orderUrl) lines.push('', input.orderUrl)
  return lines.join('\n')
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(area)
      return copied
    } catch {
      return false
    }
  }
}

export function catalogUrl(slug: string): string {
  const base =
    (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/+$/, '') ||
    window.location.origin
  return `${base}/c/${slug}`
}
