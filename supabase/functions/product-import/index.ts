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
  MAX_IMPORT_ROWS,
  planImportRows,
  type ImportCategoryRef,
  type ImportProductRef,
} from '../_shared/import.ts'

const MAX_IMPORT_BODY_BYTES = 300_000

function importError(error: { message?: string }): HttpError {
  const message = error.message ?? ''
  if (message.includes('job_tenant_mismatch')) {
    return new HttpError(403, 'job_tenant_mismatch', 'Job de importação de outro tenant.')
  }
  if (
    message.includes('duplicate_import_sku') ||
    message.includes('import_sku_exists') ||
    message.includes('import_sku_not_found')
  ) {
    return new HttpError(409, 'import_conflict', 'Conflito de SKU durante a importação.')
  }
  if (
    message.includes('invalid_import_') ||
    message.includes('import_row_limit') ||
    message.includes('invalid_import_action')
  ) {
    return new HttpError(400, 'invalid_import', 'Dados de importação inválidos.')
  }
  return new HttpError(500, 'import_failed', 'Não foi possível concluir a importação.')
}

export const handler = (req: Request) =>
  withHttpErrors(req, 'product-import', async () => {
    if (req.method !== 'POST') return methodNotAllowed(req, ['POST', 'OPTIONS'])

    const supabase = adminClient()
    const { user, organization, role } = await requireSupplier(req, supabase)
    assertRole(role, ['owner', 'manager'])
    await assertWriteAccess(supabase, organization.id)
    await enforceRateLimit(supabase, `product-import:${organization.id}`, 10, 3600)

    const body = await readJson(req, MAX_IMPORT_BODY_BYTES)
    if (!isRecord(body)) throw new HttpError(400, 'invalid_import', 'Payload inválido.')

    const mode = body.mode
    if (mode !== 'dry_run' && mode !== 'commit') {
      throw new HttpError(400, 'invalid_import_mode', 'Modo de importação inválido.')
    }
    if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_IMPORT_ROWS) {
      throw new HttpError(
        400,
        'import_row_limit',
        `Envie entre 1 e ${MAX_IMPORT_ROWS} linhas por lote.`,
      )
    }

    const jobId = body.job_id
    if (mode === 'commit' && !isUuid(jobId)) {
      throw new HttpError(400, 'invalid_import_job', 'Job de importação inválido.')
    }

    const [productsResult, categoriesResult] = await Promise.all([
      supabase
        .from('products')
        .select('id, sku')
        .eq('organization_id', organization.id),
      supabase
        .from('product_categories')
        .select('id, name')
        .eq('organization_id', organization.id),
    ])
    if (productsResult.error || categoriesResult.error) {
      throw new HttpError(503, 'import_lookup_failed')
    }

    const plan = planImportRows(
      body.rows,
      (productsResult.data ?? []) as ImportProductRef[],
      (categoriesResult.data ?? []) as ImportCategoryRef[],
    )
    const summary = {
      total: plan.rows.length,
      creates: plan.creates,
      updates: plan.updates,
      ignores: plan.ignores,
      errors: plan.errors,
    }

    if (mode === 'dry_run') {
      return jsonResponse(req, {
        mode,
        job_id: isUuid(jobId) ? jobId : null,
        rows: plan.rows,
        summary,
      })
    }

    if (plan.errors > 0) {
      return jsonResponse(
        req,
        {
          error: 'import_validation_failed',
          message: 'Corrija as linhas com erro antes de confirmar.',
          rows: plan.rows,
          summary,
        },
        400,
      )
    }

    const normalized = plan.rows.map((row) => ({
      line: row.line,
      action: row.action,
      name: row.name,
      sku: row.sku,
      category: row.category,
      unit: row.unit,
      price_cents: row.price_cents,
      active: row.active,
      min_quantity: row.min_quantity,
      quantity_increment: row.quantity_increment,
    }))

    const { data, error } = await supabase.rpc('api_import_products', {
      p_job_id: jobId,
      p_organization_id: organization.id,
      p_actor_id: user.id,
      p_rows: normalized,
    })
    if (error) throw importError(error)

    const result = Array.isArray(data) ? data[0] : data
    await auditEvent(supabase, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'product.import_committed',
      entity: 'product_import_job',
      entityId: jobId as string,
      metadata: {
        total: result?.total_rows ?? summary.total,
        created: result?.created_count ?? summary.creates,
        updated: result?.updated_count ?? summary.updates,
        ignored: result?.ignored_count ?? summary.ignores,
      },
    })

    return jsonResponse(req, { mode, job_id: jobId, summary: result ?? summary })
  })

if (import.meta.main) Deno.serve(handler)
