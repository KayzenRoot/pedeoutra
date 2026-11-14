import { adminClient } from '../_shared/supabase.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  jsonResponse,
  methodNotAllowed,
  rateBucket,
  withHttpErrors,
} from '../_shared/http.ts'
import { CATALOG_TEMPLATES } from '../_shared/onboarding-templates.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'catalog-templates', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const supabase = adminClient()
    await enforceRateLimit(supabase, await rateBucket(req, 'catalog-templates'), 60, 60)

    return jsonResponse(req, {
      templates: CATALOG_TEMPLATES.map((template) => ({
        code: template.code,
        name: template.name,
        description: template.description,
        version: template.version,
        items: template.items.map((item) => ({
          key: item.key,
          name: item.name,
          category: item.category,
          unit: item.unit,
          min_quantity: item.min_quantity,
          quantity_increment: item.quantity_increment,
        })),
      })),
    })
  })

if (import.meta.main) Deno.serve(handler)
