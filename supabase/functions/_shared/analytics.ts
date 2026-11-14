import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'

export const ANALYTICS_EVENTS = new Set([
  'page_view',
  'landing_view',
  'plan_view',
  'cta_click',
  'faq_expand',
  'demo_open',
  'catalog_view',
  'private_catalog_view',
  'order_submitted',
  'reorder_view',
  'reorder_submitted',
  'signup_completed',
  'trial_started',
  'checkout_started',
  'subscription_payment_confirmed',
  'subscription_refunded',
  'plan_changed',
  'api_key_created',
  'whatsapp_inbound_started',
  'reorder_reminder_manual_opened',
])

export const SERVER_ONLY_EVENTS = new Set([
  'subscription_payment_confirmed',
  'subscription_refunded',
  'plan_changed',
  'api_key_created',
  'whatsapp_inbound_started',
])

const METADATA_KEYS = new Set([
  'plan_code',
  'source',
  'channel',
  'item_count',
  'status',
  'template_code',
  'role',
  'has_price',
  'has_sku',
  'event_target',
])

const PRIVATE_PREFIXES = ['/r/', '/p/', '/o/', '/convite/', '/acompanhar/']

export function sanitizeAnalyticsPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.split('?')[0].trim()
  if (!path.startsWith('/') || path.length > 200) return null
  for (const prefix of PRIVATE_PREFIXES) {
    if (path.startsWith(prefix)) return `${prefix}:token`
  }
  return path
}

export function sanitizeMetadata(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string | number | boolean> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!METADATA_KEYS.has(key)) continue
    if (typeof raw === 'string') result[key] = raw.slice(0, 80)
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = raw
    else if (typeof raw === 'boolean') result[key] = raw
  }
  return result
}

export function cleanAnalyticsText(value: unknown, max = 80): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, max) : null
}

export async function recordServerAnalytics(
  supabase: SupabaseClient,
  input: {
    event: string
    organizationId: string
    userId: string | null
    metadata?: Record<string, string | number | boolean>
  },
): Promise<void> {
  const { error } = await supabase.from('analytics_events').insert({
    event: input.event,
    session_id: `server:${input.organizationId}`,
    path: '/server',
    source: 'server',
    organization_id: input.organizationId,
    user_id: input.userId,
    consent_version: 'server',
    metadata: input.metadata ?? {},
  })
  if (error) {
    console.error(JSON.stringify({ scope: 'analytics_server_event', event: input.event }))
  }
}
