const CONSENT_KEY = 'pedeoutra.analytics.consent.v1'
const SESSION_KEY = 'pedeoutra.analytics.session'
const ORIGIN_KEY = 'pedeoutra.analytics.origin'
const CONSENT_VERSION = '2026-11-14'
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

const SERVER_ONLY_EVENTS = new Set([
  'subscription_payment_confirmed',
  'subscription_refunded',
  'plan_changed',
  'api_key_created',
  'whatsapp_inbound_started',
])

export interface AnalyticsConsent {
  analytics: boolean
  marketing: boolean
  version: string
  at: string
}

interface OriginData {
  referrer_class: 'direct' | 'organic' | 'paid' | 'referral' | 'unknown'
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
}

function storageAvailable(): boolean {
  try {
    const probe = '__pedeoutra_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function getAnalyticsConsent(): AnalyticsConsent | null {
  if (!storageAvailable()) return null
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AnalyticsConsent>
    if (typeof parsed.analytics !== 'boolean' || typeof parsed.marketing !== 'boolean') {
      return null
    }
    return {
      analytics: parsed.analytics,
      marketing: parsed.marketing,
      version: typeof parsed.version === 'string' ? parsed.version : CONSENT_VERSION,
      at: typeof parsed.at === 'string' ? parsed.at : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function privacySignal(): boolean {
  const nav = window.navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true
}

export function hasAnalyticsConsent(): boolean {
  const consent = getAnalyticsConsent()
  return Boolean(consent?.analytics) && !privacySignal()
}

export function sessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY)
    if (existing && /^[A-Za-z0-9._:-]{16,80}$/.test(existing)) return existing
    const generated = `s-${crypto.randomUUID().replaceAll('-', '')}`
    window.sessionStorage.setItem(SESSION_KEY, generated)
    return generated
  } catch {
    return `s-${crypto.randomUUID().replaceAll('-', '')}`
  }
}

function safePath(): string {
  const path = window.location.pathname.split('?')[0]
  if (path.startsWith('/r/')) return '/r/:token'
  if (path.startsWith('/p/')) return '/p/:token'
  if (path.startsWith('/o/')) return '/o/:token'
  if (path.startsWith('/convite/')) return '/convite/:token'
  if (path.startsWith('/acompanhar/')) return '/acompanhar/:token'
  return path
}

function originData(): OriginData {
  try {
    const cached = window.sessionStorage.getItem(ORIGIN_KEY)
    if (cached) return JSON.parse(cached) as OriginData
  } catch {
    // Calcula novamente.
  }

  const params = new URLSearchParams(window.location.search)
  const utmSource = params.get('utm_source')?.trim().slice(0, 80) || null
  const utmMedium = params.get('utm_medium')?.trim().slice(0, 80) || null
  const utmCampaign = params.get('utm_campaign')?.trim().slice(0, 80) || null
  const referrer = document.referrer
  let referrerClass: OriginData['referrer_class'] = 'direct'
  if (utmMedium === 'cpc' || utmMedium === 'paid' || utmMedium === 'ads') {
    referrerClass = 'paid'
  } else if (/google|bing|duckduckgo|yahoo|ecosia/i.test(referrer)) {
    referrerClass = 'organic'
  } else {
    try {
      referrerClass = new URL(referrer).origin === window.location.origin ? 'direct' : 'referral'
    } catch {
      referrerClass = 'unknown'
    }
  }
  const data: OriginData = {
    referrer_class: referrerClass,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
  }
  try {
    window.sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(data))
  } catch {
    // Sem storage, mantém apenas nesta chamada.
  }
  return data
}

export function setAnalyticsConsent(analytics: boolean, marketing: boolean): void {
  const effectiveAnalytics = analytics && !privacySignal()
  const consent: AnalyticsConsent = {
    analytics: effectiveAnalytics,
    marketing,
    version: CONSENT_VERSION,
    at: new Date().toISOString(),
  }
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent))
  } catch {
    // Consentimento não persiste; ainda tenta registrar no servidor.
  }
  if (!SUPABASE_URL || !ANON_KEY) return
  void fetch(`${SUPABASE_URL}/functions/v1/analytics-consent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({
      session_id: sessionId(),
      analytics: effectiveAnalytics,
      marketing,
      consent_version: CONSENT_VERSION,
    }),
    keepalive: true,
  }).catch(() => undefined)
}

/**
 * Envia somente evento e metadados allowlisted; nunca PII, token ou query string.
 * Sem consentimento de analytics, a chamada é um no-op.
 */
export function track(
  event: string,
  metadata: Record<string, string | number | boolean> = {},
): void {
  if (!hasAnalyticsConsent() || SERVER_ONLY_EVENTS.has(event)) return
  if (!SUPABASE_URL || !ANON_KEY) return
  const origin = originData()
  try {
    void fetch(`${SUPABASE_URL}/functions/v1/analytics-ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        event,
        session_id: sessionId(),
        path: safePath(),
        consent_version: CONSENT_VERSION,
        metadata,
        ...origin,
      }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // Analytics nunca quebra a aplicação.
  }
}
