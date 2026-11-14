import { adminClient } from '../_shared/supabase.ts'
import { assertWriteAccess, requireSupplier } from '../_shared/auth.ts'
import { assertEntitlement } from '../_shared/entitlements.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  appBaseUrl,
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { parseQuoteActionInput } from '../_shared/validation.ts'
import { generateReorderToken, sha256Hex } from '../_shared/tokens.ts'
import { throwQuoteError } from '../_shared/quote-errors.ts'

const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const handler = (req: Request) =>
  withHttpErrors(req, 'quote-send', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)
    await assertEntitlement(supabase, organization.id, 'quotes')
    await enforceRateLimit(supabase, `quote-send:${organization.id}`, 60, 3600)

    const parsed = parseQuoteActionInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Orçamento inválido.')
    }

    const token = generateReorderToken()
    const tokenHash = await sha256Hex(token)
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString()
    const input = parsed.value
    const { data, error } = await supabase.rpc('api_send_quote', {
      p_organization_id: organization.id,
      p_actor_user_id: user.id,
      p_quote_id: input.quoteId,
      p_expected_version: input.expectedVersion,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
    })
    if (error) throwQuoteError(error)

    const quote = Array.isArray(data) ? data[0] : data
    if (!quote) throw new HttpError(500, 'quote_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'quote.sent',
      entity: 'quote',
      entityId: input.quoteId,
      metadata: { expires_at: quote.expires_at, version: quote.version },
    })

    return jsonResponse(
      req,
      {
        url: `${appBaseUrl()}/o/${token}`,
        expires_at: quote.expires_at,
        version: quote.version,
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
