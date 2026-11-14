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
import { parseQuoteCreateInput } from '../_shared/validation.ts'
import { throwQuoteError } from '../_shared/quote-errors.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'quote-create', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await assertWriteAccess(supabase, organization.id)
    await assertEntitlement(supabase, organization.id, 'quotes')
    await enforceRateLimit(supabase, `quote-create:${organization.id}`, 60, 3600)

    const parsed = parseQuoteCreateInput(await readJson(req))
    if (!parsed.ok) {
      throw new HttpError(400, parsed.error, 'Revise o cliente, os itens e a validade.')
    }

    const input = parsed.value
    const { data, error } = await supabase.rpc('api_create_quote', {
      p_organization_id: organization.id,
      p_actor_user_id: user.id,
      p_customer_id: input.customerId,
      p_items: input.items,
      p_valid_until: input.validUntil,
      p_notes: input.notes,
    })
    if (error) throwQuoteError(error)

    const quote = Array.isArray(data) ? data[0] : data
    if (!quote) throw new HttpError(500, 'quote_failed')

    return jsonResponse(
      req,
      {
        quote_id: quote.quote_id,
        public_reference: quote.public_reference,
        total_cents: quote.total_cents,
        item_count: quote.item_count,
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
