import { adminClient } from '../_shared/supabase.ts'
import { assertRole, assertWriteAccess, requireSupplier } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { assertEntitlement } from '../_shared/entitlements.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { cleanText, isUuid } from '../_shared/validation.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'reorder-reminder-create', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager', 'operator'])
    await assertWriteAccess(supabase, organization.id)
    await assertEntitlement(supabase, organization.id, 'reorder_radar')
    await enforceRateLimit(supabase, `reminder-create:${organization.id}`, 60, 3600)

    const body = (await readJson(req)) as Record<string, unknown>
    if (!isUuid(body.customer_id)) {
      throw new HttpError(400, 'invalid_customer', 'Cliente inválido.')
    }
    const cycleKey = cleanText(body.cycle_key, 160)
    if (!cycleKey || cycleKey.length < 3) {
      throw new HttpError(400, 'invalid_cycle', 'Ciclo do lembrete inválido.')
    }
    const message = cleanText(body.message, 1000)
    if (!message || message.length < 3) {
      throw new HttpError(400, 'invalid_message', 'Mensagem inválida.')
    }

    const { data: organizationSettings } = await supabase
      .from('organizations')
      .select('reorder_reminder_enabled')
      .eq('id', organization.id)
      .maybeSingle()
    if (!organizationSettings?.reorder_reminder_enabled) {
      throw new HttpError(409, 'reminders_disabled', 'Ative os lembretes nas configurações.')
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, reorder_opt_in, reorder_opt_out_at')
      .eq('id', body.customer_id)
      .eq('organization_id', organization.id)
      .maybeSingle()
    if (!customer) throw new HttpError(404, 'customer_not_found', 'Cliente não encontrado.')
    if (!customer.reorder_opt_in || customer.reorder_opt_out_at) {
      throw new HttpError(
        409,
        'reminder_not_consented',
        'Este cliente não autorizou lembretes de reposição.',
      )
    }

    const { data, error } = await supabase
      .from('reorder_reminders')
      .upsert(
        {
          organization_id: organization.id,
          customer_id: body.customer_id,
          channel: 'manual',
          status: 'suggested',
          cycle_key: cycleKey,
          message,
          created_by: user.id,
          metadata: { source: 'radar' },
        },
        { onConflict: 'organization_id,customer_id,cycle_key,channel' },
      )
      .select('id, status, created_at')
      .single()
    if (error) throw new HttpError(500, 'reminder_create_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'reorder.reminder_created',
      entity: 'reorder_reminder',
      entityId: data.id,
      metadata: { customer_id: body.customer_id, channel: 'manual' },
    })

    return jsonResponse(
      req,
      { reminder_id: data.id, status: data.status, created_at: data.created_at },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
