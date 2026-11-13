import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import { effectivePlan } from '../_shared/entitlements.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isPlanCode, planAvailability } from '../_shared/plans.ts'

/**
 * Contrato de troca de plano.
 *
 * O Asaas pode não permitir editar valor/vencimento de assinatura de cartão.
 * Sem um caminho comprovado de substituição sem sobreposição, a troca é
 * bloqueada e direcionada ao suporte. Nunca criamos uma segunda recorrência.
 */
export const handler = (req: Request) =>
  withHttpErrors(req, 'change-plan', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization } = await requireSupplier(req, supabase)
    await enforceRateLimit(supabase, `plan-change:${organization.id}`, 5, 3600)

    const body = (await readJson(req)) as Record<string, unknown>
    const target = body.plan_code
    if (!isPlanCode(target)) throw new HttpError(400, 'invalid_plan', 'Plano inválido.')

    const current = await effectivePlan(supabase, organization.id)
    if (!current) {
      throw new HttpError(403, 'subscription_inactive', 'Não há plano ativo para trocar.')
    }
    if (current.plan_code === target) {
      throw new HttpError(409, 'plan_unchanged', 'Este já é o seu plano atual.')
    }

    const availability = planAvailability(target, (name) => Deno.env.get(name))
    if (!availability.available) {
      throw new HttpError(
        409,
        'plan_not_available',
        'O plano Profissional ainda não está disponível para contratação.',
      )
    }

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('id, current_period_end, plan_code')
      .eq('organization_id', organization.id)
      .maybeSingle()
    if (error) throw new HttpError(500, 'subscription_lookup_failed')

    const effectiveAt = subscription?.current_period_end ?? null
    const reason = 'provider_transition_not_verified'

    const { error: changeError } = await supabase.from('plan_changes').insert({
      organization_id: organization.id,
      from_plan_code: current.plan_code,
      to_plan_code: target,
      status: 'blocked',
      effective_at: effectiveAt,
      requested_by: user.id,
      reason,
      metadata: {
        current_access_kind: current.access_kind,
        current_plan_version: current.plan_version,
      },
    })
    if (changeError) throw new HttpError(500, 'plan_change_save_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'billing.plan_change_blocked',
      entity: 'subscription',
      entityId: subscription?.id ?? null,
      metadata: { from_plan: current.plan_code, to_plan: target, reason },
    })

    return jsonResponse(
      req,
      {
        error: 'plan_change_requires_support',
        message:
          'A troca de plano exige atendimento para evitar cobrança duplicada. Nenhuma cobrança foi criada.',
        current_plan: current.plan_code,
        target_plan: target,
        effective_at: effectiveAt,
        support_required: true,
      },
      409,
    )
  })

if (import.meta.main) Deno.serve(handler)
