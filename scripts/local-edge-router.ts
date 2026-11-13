/**
 * Router local de teste para Edge Functions públicas.
 * Não vai para produção; permite exercitar os handlers Deno sem o container
 * edge-runtime (que falhou nesta máquina por imagem 0-byte).
 */
import { handler as publicCatalog } from '../supabase/functions/public-catalog/index.ts'
import { handler as publicOrder } from '../supabase/functions/public-order/index.ts'
import { handler as reorderGet } from '../supabase/functions/reorder-get/index.ts'
import { handler as reorderSubmit } from '../supabase/functions/reorder-submit/index.ts'
import { handler as linkOrderCustomer } from '../supabase/functions/link-order-customer/index.ts'
import { handler as reorderCreate } from '../supabase/functions/reorder-create/index.ts'
import { handler as reorderRevoke } from '../supabase/functions/reorder-revoke/index.ts'
import { handler as createCheckout } from '../supabase/functions/create-checkout/index.ts'
import { handler as cancelSubscription } from '../supabase/functions/cancel-subscription/index.ts'
import { handler as asaasWebhook } from '../supabase/functions/asaas-webhook/index.ts'
import { handler as billingReconcile } from '../supabase/functions/billing-reconcile/index.ts'
import { handler as planCatalog } from '../supabase/functions/plan-catalog/index.ts'
import { handler as changePlan } from '../supabase/functions/change-plan/index.ts'
import { handler as adminApi } from '../supabase/functions/admin-api/index.ts'
import { handler as adminBootstrap } from '../supabase/functions/admin-bootstrap/index.ts'

type Handler = (request: Request) => Promise<Response>

const routes: Record<string, Handler> = {
  'public-catalog': publicCatalog,
  'public-order': publicOrder,
  'reorder-get': reorderGet,
  'reorder-submit': reorderSubmit,
  'link-order-customer': linkOrderCustomer,
  'reorder-create': reorderCreate,
  'reorder-revoke': reorderRevoke,
  'create-checkout': createCheckout,
  'cancel-subscription': cancelSubscription,
  'asaas-webhook': asaasWebhook,
  'billing-reconcile': billingReconcile,
  'plan-catalog': planCatalog,
  'change-plan': changePlan,
  'admin-api': adminApi,
  'admin-bootstrap': adminBootstrap,
}

const port = Number(Deno.env.get('EDGE_PORT') ?? '8000')

Deno.serve({ port, hostname: '127.0.0.1' }, (request) => {
  const path = new URL(request.url).pathname
  if (path === '/health') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const name = path.split('/').filter(Boolean).pop() ?? ''
  const handler = routes[name]
  if (!handler) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return handler(request)
})

console.log(`local-edge-router listening on ${port}`)
