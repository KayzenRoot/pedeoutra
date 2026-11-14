import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier, assertWriteAccess , assertRole} from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { auditEvent } from '../_shared/audit.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  withHttpErrors,
} from '../_shared/http.ts'
import { isRecord, isUuid } from '../_shared/validation.ts'
import {
  CATALOG_TEMPLATES,
  findCatalogTemplate,
  type CatalogTemplate,
} from '../_shared/onboarding-templates.ts'

interface SeedItemInput {
  item_key: string
  name: string
  category: string
  unit: string
  min_quantity: number
  quantity_increment: number
}

function normalizedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > max || /[<>]/.test(text)) return null
  return text
}

function integer(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 999) return null
  return numeric
}

function normalizeItems(
  template: CatalogTemplate,
  rawItems: unknown,
): SeedItemInput[] {
  if (!Array.isArray(rawItems) || rawItems.length > template.items.length) {
    throw new HttpError(400, 'invalid_seed_items', 'Itens do template inválidos.')
  }

  const allowed = new Map(template.items.map((item) => [item.key, item]))
  const seen = new Set<string>()
  return rawItems.map((raw) => {
    if (!isRecord(raw)) {
      throw new HttpError(400, 'invalid_seed_items', 'Item do template inválido.')
    }
    const key = typeof raw.item_key === 'string' ? raw.item_key : ''
    const base = allowed.get(key)
    if (!base || seen.has(key)) {
      throw new HttpError(400, 'invalid_seed_items', 'Item do template inválido.')
    }
    seen.add(key)

    const name = normalizedText(raw.name ?? base.name, 120)
    const category = normalizedText(raw.category ?? base.category, 80)
    const unit = normalizedText(raw.unit ?? base.unit, 20)
    const minQuantity = integer(raw.min_quantity ?? base.min_quantity)
    const quantityIncrement = integer(raw.quantity_increment ?? base.quantity_increment)

    if (!name || !category || !unit || !minQuantity || !quantityIncrement) {
      throw new HttpError(400, 'invalid_seed_items', 'Item do template inválido.')
    }
    if (minQuantity % quantityIncrement !== 0) {
      throw new HttpError(
        400,
        'invalid_seed_items',
        'A quantidade mínima precisa ser múltipla do incremento.',
      )
    }

    return {
      item_key: key,
      name,
      category,
      unit,
      min_quantity: minQuantity,
      quantity_increment: quantityIncrement,
    }
  })
}

function templateConflict(code: string, version: number): HttpError {
  const sameCode = CATALOG_TEMPLATES.some((template) => template.code === code)
  if (sameCode) {
    return new HttpError(
      409,
      'template_version_mismatch',
      'O template mudou. Recarregue a página e tente novamente.',
    )
  }
  return new HttpError(404, 'template_not_found', 'Template não encontrado.')
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'onboarding-seed', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager'])
    await assertWriteAccess(supabase, organization.id)
    await enforceRateLimit(supabase, `catalog-seed:${organization.id}`, 10, 3600)

    const body = await readJson(req)
    if (!isRecord(body)) throw new HttpError(400, 'invalid_seed', 'Payload inválido.')

    const mode = body.mode
    if (mode !== 'preview' && mode !== 'commit') {
      throw new HttpError(400, 'invalid_seed_mode', 'Modo de seed inválido.')
    }
    const code = typeof body.template_code === 'string' ? body.template_code : ''
    const version = Number(body.template_version)
    const template = findCatalogTemplate(code, version)
    if (!template) throw templateConflict(code, version)

    const items = normalizeItems(template, body.items ?? [])

    if (mode === 'preview') {
      const [seedResult, productResult] = await Promise.all([
        supabase
          .from('catalog_seed_items')
          .select('item_key')
          .eq('organization_id', organization.id)
          .eq('template_code', code)
          .eq('template_version', version),
        supabase
          .from('products')
          .select('name')
          .eq('organization_id', organization.id),
      ])
      if (seedResult.error || productResult.error) {
        throw new HttpError(503, 'seed_preview_failed')
      }
      const seeded = new Set((seedResult.data ?? []).map((row) => row.item_key))
      const names = new Set(
        (productResult.data ?? []).map((row) => row.name.trim().toLowerCase()),
      )
      return jsonResponse(req, {
        mode,
        template: { code: template.code, name: template.name, version: template.version },
        items: items.map((item) => {
          let reason: string | null = null
          if (seeded.has(item.item_key)) {
            reason = 'Já importado por este template'
          } else if (names.has(item.name.toLowerCase())) {
            reason = 'Já existe um produto com este nome'
          }
          return { ...item, conflict: Boolean(reason), conflict_reason: reason }
        }),
        summary: {
          selected: items.length,
          conflicts: items.filter(
            (item) =>
              seeded.has(item.item_key) || names.has(item.name.toLowerCase()),
          ).length,
        },
      })
    }

    if (!isUuid(body.job_id)) {
      throw new HttpError(400, 'invalid_seed_job', 'Job de seed inválido.')
    }

    const { data, error } = await supabase.rpc('api_seed_catalog', {
      p_job_id: body.job_id,
      p_organization_id: organization.id,
      p_actor_id: user.id,
      p_template_code: template.code,
      p_template_version: template.version,
      p_items: items,
    })
    if (error) {
      if (String(error.message).includes('seed_job_tenant_mismatch')) {
        throw new HttpError(403, 'seed_job_tenant_mismatch', 'Job de outro tenant.')
      }
      throw new HttpError(500, 'seed_failed', 'Não foi possível criar o catálogo.')
    }

    const summary = Array.isArray(data) ? data[0] : data
    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'catalog.template_seeded',
      entity: 'catalog_seed_job',
      entityId: body.job_id as string,
      metadata: {
        template_code: template.code,
        template_version: template.version,
        created: summary?.created_count ?? 0,
        skipped: summary?.skipped_count ?? 0,
      },
    })

    return jsonResponse(req, {
      mode,
      job_id: body.job_id,
      template: { code: template.code, name: template.name, version: template.version },
      summary: summary ?? { created_count: 0, skipped_count: 0, total_items: items.length },
    })
  })

if (import.meta.main) Deno.serve(handler)
