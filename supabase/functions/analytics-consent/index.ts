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
import { cleanAnalyticsText } from '../_shared/analytics.ts'

const SESSION_PATTERN = /^[A-Za-z0-9._:-]{16,80}$/

export const handler = (req: Request) =>
  withHttpErrors(req, 'analytics-consent', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const body = (await readJson(req)) as Record<string, unknown>
    const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
    if (!SESSION_PATTERN.test(sessionId)) {
      throw new HttpError(400, 'invalid_session', 'Sessão inválida.')
    }
    const version = cleanAnalyticsText(body.consent_version, 40)
    if (!version) throw new HttpError(400, 'invalid_consent_version', 'Versão inválida.')

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'analytics-consent'), 30, 600)

    const { error } = await supabase.from('analytics_consents').upsert(
      {
        session_id: sessionId,
        analytics: body.analytics === true,
        marketing: body.marketing === true,
        consent_version: version,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' },
    )
    if (error) throw new HttpError(500, 'analytics_consent_failed')

    return jsonResponse(req, {
      analytics: body.analytics === true,
      marketing: body.marketing === true,
      consent_version: version,
    })
  })

if (import.meta.main) Deno.serve(handler)
