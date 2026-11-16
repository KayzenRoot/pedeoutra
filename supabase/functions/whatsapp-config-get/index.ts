import { adminClient } from '../_shared/supabase.ts'
import { requireSupplier } from '../_shared/auth.ts'
import {
  HttpError,
  jsonResponse,
  methodNotAllowed,
  withHttpErrors,
} from '../_shared/http.ts'

export const handler = (req: Request) =>
  withHttpErrors(req, 'whatsapp-config-get', async () => {
    if (req.method !== 'GET') return methodNotAllowed(req, ['GET', 'OPTIONS'])

    const supabase = adminClient()
    const { organization } = await requireSupplier(req, supabase)

    const [connectionResult, templatesResult, outboxResult] = await Promise.all([
      supabase
        .from('whatsapp_connections')
        .select('waba_id, phone_number_id, status, last_error, updated_at')
        .eq('organization_id', organization.id)
        .maybeSingle(),
      supabase
        .from('whatsapp_templates')
        .select('event, template_name, language, status, updated_at')
        .eq('organization_id', organization.id)
        .order('event', { ascending: true }),
      supabase
        .from('whatsapp_outbox')
        .select('status')
        .eq('organization_id', organization.id),
    ])
    if (connectionResult.error || templatesResult.error || outboxResult.error) {
      throw new HttpError(503, 'whatsapp_lookup_failed')
    }

    const outbox = outboxResult.data ?? []
    const connection = connectionResult.data
    const templates = templatesResult.data ?? []
    return jsonResponse(req, {
      connection: connection
        ? {
            waba_id: connection.waba_id,
            phone_number_id: connection.phone_number_id,
            status: connection.status,
            last_error: connection.last_error,
            updated_at: connection.updated_at,
          }
        : null,
      templates,
      outbox: {
        blocked: outbox.filter((row) => row.status === 'blocked').length,
        pending: outbox.filter((row) => row.status === 'pending').length,
        sent: outbox.filter((row) => row.status === 'sent').length,
        failed: outbox.filter((row) => row.status === 'failed').length,
      },
      send_enabled:
        Deno.env.get('WHATSAPP_SEND_ENABLED') === 'true' &&
        connection?.status === 'connected' &&
        templates.some((template) => template.status === 'approved'),
      encryption_configured: Boolean(Deno.env.get('WHATSAPP_ENCRYPTION_KEY')),
      webhook_configured: Boolean(Deno.env.get('WHATSAPP_WEBHOOK_SECRET')),
      provider: 'meta_cloud_api',
    })
  })

if (import.meta.main) Deno.serve(handler)
