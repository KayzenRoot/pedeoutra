import { adminClient } from '../_shared/supabase.ts'
import { assertRole, requireSupplier } from '../_shared/auth.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isUuid } from '../_shared/validation.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'reorder-reminder-open', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager', 'operator'])

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.reminder_id)) {
      throw new HttpError(400, 'invalid_reminder', 'Lembrete inválido.')
    }

    const { data, error } = await supabase
      .from('reorder_reminders')
      .update({ status: 'manual_opened', opened_at: new Date().toISOString() })
      .eq('id', body.reminder_id)
      .eq('organization_id', organization.id)
      .eq('status', 'suggested')
      .select('id, status, opened_at')
      .maybeSingle()
    if (error) throw new HttpError(500, 'reminder_open_failed')
    if (!data) {
      const { data: existing } = await supabase
        .from('reorder_reminders')
        .select('id, status, opened_at')
        .eq('id', body.reminder_id)
        .eq('organization_id', organization.id)
        .maybeSingle()
      if (!existing) throw new HttpError(404, 'reminder_not_found', 'Lembrete não encontrado.')
      return jsonResponse(req, existing)
    }
    return jsonResponse(req, data)
  })

if (import.meta.main) Deno.serve(handler)
