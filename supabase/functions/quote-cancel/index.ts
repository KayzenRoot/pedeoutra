import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier , assertRole} from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { parseQuoteActionInput } from '../_shared/validation.ts'
import { throwQuoteError } from '../_shared/quote-errors.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'quote-cancel', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager', 'operator'])
    await enforceRateLimit(supabase, `quote-cancel:${organization.id}`, 60, 3600)

    const parsed = parseQuoteActionInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Orçamento inválido.')
    }

    const input = parsed.value
    const { data, error } = await supabase.rpc('api_cancel_quote', {
      p_organization_id: organization.id,
      p_actor_user_id: user.id,
      p_quote_id: input.quoteId,
      p_expected_version: input.expectedVersion,
    })
    if (error) throwQuoteError(error)

    const quote = Array.isArray(data) ? data[0] : data
    if (!quote) throw new HttpError(500, 'quote_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'quote.canceled',
      entity: 'quote',
      entityId: input.quoteId,
      metadata: { version: quote.version },
    })

    return jsonResponse(req, { status: quote.status, version: quote.version })
  })

if (import.meta.main) Deno.serve(handler)
