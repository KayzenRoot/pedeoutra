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

async function getOverview(supabase: SupabaseClient, req: Request): Promise<Response> {
  const { data, error } = await supabase.rpc('api_admin_overview')
  if (error) throw rpcError(error)
  return jsonResponse(req, {
    overview: Array.isArray(data) ? (data[0] ?? null) : data,
  })
}

async function getOrganizations(
  supabase: SupabaseClient,
  req: Request,
  url: URL,
): Promise<Response> {
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

async function getAudit(
  supabase: SupabaseClient,
  req: Request,
  url: URL,
): Promise<Response> {
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

async function getFinance(
  supabase: SupabaseClient,
  req: Request,
  url: URL,
  adminId: string,
): Promise<Response> {
  const days = intParam(url.searchParams.get('days'), 30, 1, 365)
  const { data, error } = await supabase.rpc('api_admin_financial', {
    p_actor_id: adminId,
    p_days: days,
  })
  if (error) {
    logError('admin_finance', new Error(error.message), { code: error.code })
    throw rpcError(error)
  }
  return jsonResponse(req, { days, metrics: data ?? [] })
}

async function getAnalytics(
  supabase: SupabaseClient,
  req: Request,
  url: URL,
  adminId: string,
): Promise<Response> {
  const days = intParam(url.searchParams.get('days'), 30, 1, 365)
  const [eventsResult, sourcesResult] = await Promise.all([
    supabase.rpc('api_admin_analytics', { p_actor_id: adminId, p_days: days }),
    supabase.rpc('api_admin_analytics_sources', { p_actor_id: adminId, p_days: days }),
  ])
  if (eventsResult.error || sourcesResult.error) throw rpcError(eventsResult.error ?? sourcesResult.error ?? {})
  return jsonResponse(req, {
    days,
    events: eventsResult.data ?? [],
    sources: sourcesResult.data ?? [],
  })
}

async function handleGet(
  supabase: SupabaseClient,
  adminId: string,
  req: Request,
  url: URL,
): Promise<Response> {
  const view = url.searchParams.get('view') ?? 'overview'
  await logAccess(supabase, adminId, view)

  if (view === 'overview') return getOverview(supabase, req)
  if (view === 'organizations') return getOrganizations(supabase, req, url)
  if (view === 'audit') return getAudit(supabase, req, url)
  if (view === 'analytics') return getAnalytics(supabase, req, url, adminId)
  if (view === 'finance') return getFinance(supabase, req, url, adminId)
  throw new HttpError(400, 'invalid_view', 'Visão administrativa inválida.')
}

interface AdminActionInput {
  action: string
  organizationId: string
  reason: string
}

function readActionInput(body: Record<string, unknown>): AdminActionInput {
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
    throw new HttpError(400, 'invalid_reason', 'Informe um motivo entre 5 e 500 caracteres.')
  }

  return { action, organizationId, reason }
}

async function handlePost(
  supabase: SupabaseClient,
  adminId: string,
  req: Request,
): Promise<Response> {
  const body = (await readJson(req)) as Record<string, unknown>
  const { action, organizationId, reason } = readActionInput(body)

  if (action === 'org.suspend' || action === 'org.reactivate') {
    const { data, error } = await supabase.rpc('api_admin_set_org_access', {
      p_actor_id: adminId,
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
      p_actor_id: adminId,
      p_organization_id: organizationId,
      p_action: action.replace('trial.', ''),
      p_reason: reason,
    })
    if (error) throw rpcError(error)
    return jsonResponse(req, { ok: true, result: data })
  }

  throw new HttpError(400, 'invalid_action', 'Ação administrativa inválida.')
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'admin-api', async () => {
    if (!['GET', 'POST'].includes(req.method)) {
      return methodNotAllowed(req, ['GET', 'POST', 'OPTIONS'])
    }

    const supabase = adminClient()
    const admin = await requirePlatformAdmin(req, supabase)
    await enforceRateLimit(supabase, `admin:${admin.userId}`, 120, 60)

    if (req.method === 'GET') {
      return handleGet(supabase, admin.userId, req, new URL(req.url))
    }
    return handlePost(supabase, admin.userId, req)
  })

if (import.meta.main) Deno.serve(handler)
