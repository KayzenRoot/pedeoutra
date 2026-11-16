import { adminClient } from '../_shared/supabase.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import {
  ANALYTICS_EVENTS,
  SERVER_ONLY_EVENTS,
  cleanAnalyticsText,
  sanitizeAnalyticsPath,
  sanitizeMetadata,
} from '../_shared/analytics.ts'

const SESSION_PATTERN = /^[A-Za-z0-9._:-]{16,80}$/
const REFERRER_CLASSES = new Set(['direct', 'organic', 'paid', 'referral', 'unknown'])

export const handler = (req: Request) =>
  withHttpErrors(req, 'analytics-ingest', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const body = (await readJson(req)) as Record<string, unknown>
    const event = typeof body.event === 'string' ? body.event : ''
    if (!ANALYTICS_EVENTS.has(event) || SERVER_ONLY_EVENTS.has(event)) {
      throw new HttpError(400, 'invalid_event', 'Evento inválido.')
    }
    const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
    if (!SESSION_PATTERN.test(sessionId)) {
      throw new HttpError(400, 'invalid_session', 'Sessão inválida.')
    }
    const path = sanitizeAnalyticsPath(body.path)
    if (!path) throw new HttpError(400, 'invalid_path', 'Rota inválida.')
    const consentVersion = cleanAnalyticsText(body.consent_version, 40)
    if (!consentVersion) {
      throw new HttpError(400, 'consent_required', 'Consentimento obrigatório.')
    }

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'analytics'), 120, 60)
    await enforceRateLimit(supabase, `analytics-session:${sessionId}`, 60, 60)

    const referrerClass =
      typeof body.referrer_class === 'string' && REFERRER_CLASSES.has(body.referrer_class)
        ? body.referrer_class
        : 'unknown'

    const { error } = await supabase.from('analytics_events').insert({
      event,
      session_id: sessionId,
      path,
      source: 'frontend',
      referrer_class: referrerClass,
      utm_source: cleanAnalyticsText(body.utm_source),
      utm_medium: cleanAnalyticsText(body.utm_medium),
      utm_campaign: cleanAnalyticsText(body.utm_campaign),
      consent_version: consentVersion,
      metadata: sanitizeMetadata(body.metadata),
    })
    if (error) throw new HttpError(500, 'analytics_ingest_failed')

    return jsonResponse(req, { accepted: true }, 202)
  })

if (import.meta.main) Deno.serve(handler)
