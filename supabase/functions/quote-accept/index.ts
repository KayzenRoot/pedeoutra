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
import { parseQuoteAcceptInput } from '../_shared/validation.ts'
import { sha256Hex } from '../_shared/tokens.ts'
import { throwQuoteError } from '../_shared/quote-errors.ts'

const QUOTE_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'quote-accept', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const parsed = parseQuoteAcceptInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Confirme o aceite para continuar.')
    }

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'quote-accept'), 30, 600)
    const tokenHash = await sha256Hex(parsed.value.token)
    await enforceRateLimit(supabase, `quote-accept:${tokenHash.slice(0, 24)}`, 20, 600)

    const { data, error } = await supabase.rpc('api_accept_quote', {
      p_token_hash: tokenHash,
      p_request_id: parsed.value.requestId,
      p_agent: req.headers.get('user-agent') ?? null,
    })
    if (error) throwQuoteError(error)

    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new HttpError(500, 'quote_failed')
    if (result.error_code) throwQuoteError({ message: result.error_code })

    return jsonResponse(
      req,
      {
        status: 'accepted',
        order_reference: result.public_reference,
        quote_reference: result.quote_reference,
        total_cents: result.total_cents,
        item_count: result.item_count,
        already_accepted: result.already_accepted === true,
      },
      result.already_accepted === true ? 200 : 201,
      QUOTE_HEADERS,
    )
  })

if (import.meta.main) Deno.serve(handler)
