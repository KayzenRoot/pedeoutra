import { adminClient } from '../_shared/supabase.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'
import { hasApiScope, requireApiKey } from '../_shared/api-keys.ts'

const API_QUOTA = 10_000
const API_QUOTA_WINDOW = 2_678_400
const STATUSES = new Set(['new', 'confirmed', 'completed', 'canceled'])

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

function apiPath(req: Request): string {
  const path = new URL(req.url).pathname
  return path.replace(/^\/functions\/v1\/api-v1/, '').replace(/^\/api-v1/, '') || '/'
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'api-v1', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const supabase = adminClient()
    const context = await requireApiKey(req, supabase)
    await enforceRateLimit(supabase, `api-key:${context.keyId}`, 60, 60)

    const { data: entitled, error: entitlementError } = await supabase.rpc(
      'api_assert_entitlement',
      { p_organization_id: context.organizationId, p_feature_key: 'api_access' },
    )
    if (entitlementError) throw new HttpError(503, 'entitlement_check_failed')
    if (entitled !== true) {
      throw new HttpError(403, 'plan_required', 'A API exige o plano Profissional ativo.')
    }

    const { data: withinQuota, error: quotaError } = await supabase.rpc('api_consume_quota', {
      p_organization_id: context.organizationId,
      p_quota_key: 'api_access',
      p_limit: API_QUOTA,
      p_window_seconds: API_QUOTA_WINDOW,
    })
    if (quotaError) throw new HttpError(503, 'quota_check_failed')
    if (withinQuota !== true) {
      throw new HttpError(429, 'api_quota_exceeded', 'Quota mensal da API esgotada.')
    }

    const url = new URL(req.url)
    const path = apiPath(req)

    if (path === '/v1/me') {
      const [organizationResult, planResult] = await Promise.all([
        supabase
          .from('organizations')
          .select('name, slug')
          .eq('id', context.organizationId)
          .maybeSingle(),
        supabase.rpc('api_effective_plan', {
          p_organization_id: context.organizationId,
        }),
      ])
      if (organizationResult.error || planResult.error) {
        throw new HttpError(503, 'api_lookup_failed')
      }
      const plan = Array.isArray(planResult.data) ? planResult.data[0] : planResult.data
      return jsonResponse(req, {
        organization: organizationResult.data,
        plan,
        scopes: context.scopes,
        key_prefix: context.prefix,
      })
    }

    if (path === '/v1/products') {
      if (!hasApiScope(context, 'catalog:read')) {
        throw new HttpError(403, 'insufficient_scope', 'Escopo catalog:read necessário.')
      }
      const limit = intParam(url.searchParams.get('limit'), 50, 1, 100)
      const offset = intParam(url.searchParams.get('offset'), 0, 0, 100_000)
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, unit, price_cents, min_quantity, quantity_increment, category_id, active, updated_at')
        .eq('organization_id', context.organizationId)
        .eq('active', true)
        .order('name', { ascending: true })
        .range(offset, offset + limit - 1)
      if (error) throw new HttpError(503, 'api_lookup_failed')
      return jsonResponse(req, {
        data: data ?? [],
        pagination: { limit, offset, returned: data?.length ?? 0 },
      })
    }

    if (path === '/v1/customers') {
      if (!hasApiScope(context, 'customers:read')) {
        throw new HttpError(403, 'insufficient_scope', 'Escopo customers:read necessário.')
      }
      const limit = intParam(url.searchParams.get('limit'), 50, 1, 100)
      const offset = intParam(url.searchParams.get('offset'), 0, 0, 100_000)
      const { data, error } = await supabase
        .from('customers')
        .select('id, display_name, contact_phone, created_at, updated_at')
        .eq('organization_id', context.organizationId)
        .order('display_name', { ascending: true })
        .range(offset, offset + limit - 1)
      if (error) throw new HttpError(503, 'api_lookup_failed')
      return jsonResponse(req, {
        data: data ?? [],
        pagination: { limit, offset, returned: data?.length ?? 0 },
      })
    }

    if (path === '/v1/orders') {
      if (!hasApiScope(context, 'orders:read')) {
        throw new HttpError(403, 'insufficient_scope', 'Escopo orders:read necessário.')
      }
      const limit = intParam(url.searchParams.get('limit'), 50, 1, 100)
      const offset = intParam(url.searchParams.get('offset'), 0, 0, 100_000)
      const status = url.searchParams.get('status')?.trim() ?? ''
      if (status && !STATUSES.has(status)) {
        throw new HttpError(400, 'invalid_status', 'Status inválido.')
      }
      let query = supabase
        .from('orders')
        .select('id, public_reference, status, total_cents, customer_id, source, created_at, updated_at')
        .eq('organization_id', context.organizationId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (status) query = query.eq('status', status)
      const { data, error } = await query
      if (error) throw new HttpError(503, 'api_lookup_failed')
      return jsonResponse(req, {
        data: data ?? [],
        pagination: { limit, offset, returned: data?.length ?? 0 },
      })
    }

    throw new HttpError(404, 'api_not_found', 'Rota de API não encontrada.')
  })

if (import.meta.main) Deno.serve(handler)
