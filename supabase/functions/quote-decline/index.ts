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
import { parseQuoteDeclineInput } from '../_shared/validation.ts'
import { sha256Hex } from '../_shared/tokens.ts'
import { throwQuoteError } from '../_shared/quote-errors.ts'

const QUOTE_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'quote-decline', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const parsed = parseQuoteDeclineInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Confirme a recusa para continuar.')
    }

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'quote-decline'), 30, 600)
    const tokenHash = await sha256Hex(parsed.value.token)
    await enforceRateLimit(supabase, `quote-decline:${tokenHash.slice(0, 24)}`, 20, 600)

    const { data, error } = await supabase.rpc('api_decline_quote', {
      p_token_hash: tokenHash,
      p_agent: req.headers.get('user-agent') ?? null,
    })
    if (error) throwQuoteError(error)

    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new HttpError(500, 'quote_failed')
    if (result.status === 'expired') {
      throwQuoteError({ message: 'quote_expired' })
    }

    return jsonResponse(
      req,
      { status: result.status },
      200,
      QUOTE_HEADERS,
    )
  })

if (import.meta.main) Deno.serve(handler)
