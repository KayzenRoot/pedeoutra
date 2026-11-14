import { adminClient } from '../_shared/supabase.ts'
import { assertAal2, assertRole, requireSupplier } from '../_shared/auth.ts'
import { assertEntitlement } from '../_shared/entitlements.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { generateApiKey, apiKeyPrefix } from '../_shared/api-keys.ts'
import { sha256Hex } from '../_shared/tokens.ts'

const ALLOWED_SCOPES = new Set(['catalog:read', 'orders:read', 'customers:read'])

export const handler = (req: Request) =>
  withHttpErrors(req, 'api-key-create', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertAal2(req)
    assertRole(role, ['owner'])
    await assertEntitlement(supabase, organization.id, 'api_access')
    await enforceRateLimit(supabase, `api-key-create:${organization.id}`, 20, 3600)

    const body = (await readJson(req)) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 1 || name.length > 80) {
      throw new HttpError(400, 'invalid_name', 'Informe um nome para a chave.')
    }
    const requested = Array.isArray(body.scopes) ? body.scopes : ['catalog:read']
    if (
      requested.length < 1 ||
      requested.length > ALLOWED_SCOPES.size ||
      !requested.every((scope) => typeof scope === 'string' && ALLOWED_SCOPES.has(scope))
    ) {
      throw new HttpError(400, 'invalid_scopes', 'Escopos inválidos.')
    }

    const rawKey = generateApiKey()
    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        organization_id: organization.id,
        name,
        key_prefix: apiKeyPrefix(rawKey),
        key_hash: await sha256Hex(rawKey),
        scopes: requested,
        created_by: user.id,
      })
      .select('id, name, key_prefix, scopes, created_at')
      .single()
    if (error) throw new HttpError(500, 'api_key_create_failed')

    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'api.key_created',
      entity: 'api_key',
      entityId: data.id,
      metadata: { scopes: requested.join(',') },
    })

    return jsonResponse(
      req,
      {
        id: data.id,
        name: data.name,
        prefix: data.key_prefix,
        scopes: data.scopes,
        created_at: data.created_at,
        key: rawKey,
        warning: 'Guarde esta chave agora. Ela não será exibida novamente.',
      },
      201,
    )
  })

if (import.meta.main) Deno.serve(handler)
