import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient } from '../_shared/supabase.ts'
import { requirePlatformAdmin } from '../_shared/admin.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { isUuid } from '../_shared/validation.ts'
import {
  HttpError,
  jsonResponse,
  logError,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'

function intParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

async function logAccess(
  supabase: SupabaseClient,
  actorId: string,
  view: string,
): Promise<void> {
  const { error } = await supabase.from('platform_audit_events').insert({
    actor_user_id: actorId,
    action: 'admin.console.access',
    status: 'ok',
    metadata: { view },
  })
  if (error) logError('admin_access_audit', error, { view })
}

function rpcError(error: { message?: string }): HttpError {
  const message = error.message ?? ''
  if (message.includes('admin_forbidden')) {
    return new HttpError(403, 'admin_forbidden', 'Acesso administrativo negado.')
  }
  if (message.includes('organization_not_found') || message.includes('trial_not_found')) {
    return new HttpError(404, 'not_found', 'Organização não encontrada.')
  }
  if (message.includes('invalid_')) {
    return new HttpError(400, 'invalid_request', 'Dados inválidos para a ação administrativa.')
  }
  return new HttpError(500, 'admin_action_failed', 'Não foi possível concluir a ação.')
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'admin-api', async () => {
    if (!['GET', 'POST'].includes(req.method)) {
      return methodNotAllowed(req, ['GET', 'POST', 'OPTIONS'])
    }

    const supabase = adminClient()
    const admin = await requirePlatformAdmin(req, supabase)
    await enforceRateLimit(supabase, `admin:${admin.userId}`, 120, 60)

    const url = new URL(req.url)

    if (req.method === 'GET') {
      const view = url.searchParams.get('view') ?? 'overview'
      await logAccess(supabase, admin.userId, view)

      if (view === 'overview') {
        const { data, error } = await supabase.rpc('api_admin_overview')
        if (error) throw rpcError(error)
        return jsonResponse(req, {
          overview: Array.isArray(data) ? (data[0] ?? null) : data,
        })
      }

      if (view === 'organizations') {
        const { data, error } = await supabase.rpc('api_admin_list_organizations', {
          p_search: url.searchParams.get('search')?.trim() || null,
          p_state: url.searchParams.get('state')?.trim() || null,
          p_plan: url.searchParams.get('plan')?.trim() || null,
          p_limit: intParam(url.searchParams.get('limit'), 25, 1, 100),
          p_offset: intParam(url.searchParams.get('offset'), 0, 0, 100000),
        })
        if (error) throw rpcError(error)
        const rows = (data ?? []) as Array<{ total_count: number }>
        return jsonResponse(req, {
          organizations: rows,
          total: rows[0]?.total_count ?? 0,
        })
      }

      if (view === 'audit') {
        const { data, error } = await supabase.rpc('api_admin_platform_audit', {
          p_limit: intParam(url.searchParams.get('limit'), 50, 1, 100),
          p_offset: intParam(url.searchParams.get('offset'), 0, 0, 100000),
        })
        if (error) throw rpcError(error)
        const rows = (data ?? []) as Array<{ total_count: number }>
        return jsonResponse(req, {
          audit: rows,
          total: rows[0]?.total_count ?? 0,
        })
      }

      throw new HttpError(400, 'invalid_view', 'Visão administrativa inválida.')
    }

    const body = (await readJson(req)) as Record<string, unknown>
    const action = body.action
    const organizationId = body.organization_id
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

    if (typeof action !== 'string') {
      throw new HttpError(400, 'invalid_action', 'Ação inválida.')
    }
    if (!isUuid(organizationId)) {
      throw new HttpError(400, 'invalid_organization', 'Organização inválida.')
    }
    if (reason.length < 5 || reason.length > 500) {
      throw new HttpError(
        400,
        'invalid_reason',
        'Informe um motivo entre 5 e 500 caracteres.',
      )
    }

    if (action === 'org.suspend' || action === 'org.reactivate') {
      const { data, error } = await supabase.rpc('api_admin_set_org_access', {
        p_actor_id: admin.userId,
        p_organization_id: organizationId,
        p_action: action === 'org.suspend' ? 'suspend' : 'reactivate',
        p_reason: reason,
      })
      if (error) throw rpcError(error)
      return jsonResponse(req, { ok: true, result: data })
    }

    if (
      action === 'trial.suspend' ||
      action === 'trial.reactivate' ||
      action === 'trial.clear_review'
    ) {
      const { data, error } = await supabase.rpc('api_admin_review_trial', {
        p_actor_id: admin.userId,
        p_organization_id: organizationId,
        p_action: action.replace('trial.', ''),
        p_reason: reason,
      })
      if (error) throw rpcError(error)
      return jsonResponse(req, { ok: true, result: data })
    }

    throw new HttpError(400, 'invalid_action', 'Ação administrativa inválida.')
  })

if (import.meta.main) Deno.serve(handler)
