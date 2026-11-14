import { adminClient } from '../_shared/supabase.ts'
import { assertWriteAccess, requireSupplier } from '../_shared/auth.ts'
import { assertEntitlement } from '../_shared/entitlements.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { parseQuoteUpdateInput } from '../_shared/validation.ts'
import { throwQuoteError } from '../_shared/quote-errors.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'quote-update', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)
    await assertEntitlement(supabase, organization.id, 'quotes')
    await enforceRateLimit(supabase, `quote-update:${organization.id}`, 120, 3600)

    const parsed = parseQuoteUpdateInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Revise os itens e a validade do orçamento.')
    }

    const input = parsed.value
    const { data, error } = await supabase.rpc('api_update_quote', {
      p_organization_id: organization.id,
      p_actor_user_id: user.id,
      p_quote_id: input.quoteId,
      p_expected_version: input.expectedVersion,
      p_items: input.items,
      p_valid_until: input.validUntil,
      p_notes: input.notes,
    })
    if (error) throwQuoteError(error)

    const quote = Array.isArray(data) ? data[0] : data
    if (!quote) throw new HttpError(500, 'quote_failed')

    return jsonResponse(req, {
      quote_id: quote.quote_id,
      total_cents: quote.total_cents,
      item_count: quote.item_count,
      version: quote.version,
    })
  })

if (import.meta.main) Deno.serve(handler)
