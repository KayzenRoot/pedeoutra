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
import { handler as productImageUpload } from '../supabase/functions/product-image-upload/index.ts'
import { handler as productImageDelete } from '../supabase/functions/product-image-delete/index.ts'
import { handler as productImageCover } from '../supabase/functions/product-image-cover/index.ts'
import { handler as productImageList } from '../supabase/functions/product-image-list/index.ts'
import { handler as productImport } from '../supabase/functions/product-import/index.ts'
import { handler as catalogTemplates } from '../supabase/functions/catalog-templates/index.ts'
import { handler as onboardingSeed } from '../supabase/functions/onboarding-seed/index.ts'
import { handler as orderTrackingCreate } from '../supabase/functions/order-tracking-create/index.ts'
import { handler as orderTrackingGet } from '../supabase/functions/order-tracking-get/index.ts'
import { handler as orderTrackingRevoke } from '../supabase/functions/order-tracking-revoke/index.ts'
import { handler as privateCatalogGet } from '../supabase/functions/private-catalog-get/index.ts'
import { handler as customerPriceLinkCreate } from '../supabase/functions/customer-price-link-create/index.ts'
import { handler as customerPriceLinkRevoke } from '../supabase/functions/customer-price-link-revoke/index.ts'
import { handler as quoteCreate } from '../supabase/functions/quote-create/index.ts'
import { handler as quoteUpdate } from '../supabase/functions/quote-update/index.ts'
import { handler as quoteSend } from '../supabase/functions/quote-send/index.ts'
import { handler as quoteCancel } from '../supabase/functions/quote-cancel/index.ts'
import { handler as quoteGet } from '../supabase/functions/quote-get/index.ts'
import { handler as quoteAccept } from '../supabase/functions/quote-accept/index.ts'
import { handler as quoteDecline } from '../supabase/functions/quote-decline/index.ts'
import { handler as whatsappConfigGet } from '../supabase/functions/whatsapp-config-get/index.ts'
import { handler as whatsappConnect } from '../supabase/functions/whatsapp-connect/index.ts'
import { handler as whatsappDisconnect } from '../supabase/functions/whatsapp-disconnect/index.ts'
import { handler as whatsappWorker } from '../supabase/functions/whatsapp-worker/index.ts'
import { handler as whatsappWebhook } from '../supabase/functions/whatsapp-webhook/index.ts'
import { handler as teamList } from '../supabase/functions/team-list/index.ts'
import { handler as teamInvite } from '../supabase/functions/team-invite/index.ts'
import { handler as teamAccept } from '../supabase/functions/team-accept/index.ts'
import { handler as teamRole } from '../supabase/functions/team-role/index.ts'
import { handler as teamRevoke } from '../supabase/functions/team-revoke/index.ts'
import { handler as reorderReminderCreate } from '../supabase/functions/reorder-reminder-create/index.ts'
import { handler as reorderReminderOpen } from '../supabase/functions/reorder-reminder-open/index.ts'
import { handler as analyticsIngest } from '../supabase/functions/analytics-ingest/index.ts'
import { handler as analyticsConsent } from '../supabase/functions/analytics-consent/index.ts'
import { handler as apiKeyCreate } from '../supabase/functions/api-key-create/index.ts'
import { handler as apiKeyList } from '../supabase/functions/api-key-list/index.ts'
import { handler as apiKeyRevoke } from '../supabase/functions/api-key-revoke/index.ts'
import { handler as apiV1 } from '../supabase/functions/api-v1/index.ts'
import { handler as apiWebhookCreate } from '../supabase/functions/api-webhook-create/index.ts'
import { handler as apiWebhookList } from '../supabase/functions/api-webhook-list/index.ts'
import { handler as apiWebhookRevoke } from '../supabase/functions/api-webhook-revoke/index.ts'
import { handler as apiWebhookWorker } from '../supabase/functions/api-webhook-worker/index.ts'

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
  'product-image-upload': productImageUpload,
  'product-image-delete': productImageDelete,
  'product-image-cover': productImageCover,
  'product-image-list': productImageList,
  'product-import': productImport,
  'catalog-templates': catalogTemplates,
  'onboarding-seed': onboardingSeed,
  'order-tracking-create': orderTrackingCreate,
  'order-tracking-get': orderTrackingGet,
  'order-tracking-revoke': orderTrackingRevoke,
  'private-catalog-get': privateCatalogGet,
  'customer-price-link-create': customerPriceLinkCreate,
  'customer-price-link-revoke': customerPriceLinkRevoke,
  'quote-create': quoteCreate,
  'quote-update': quoteUpdate,
  'quote-send': quoteSend,
  'quote-cancel': quoteCancel,
  'quote-get': quoteGet,
  'quote-accept': quoteAccept,
  'quote-decline': quoteDecline,
  'whatsapp-config-get': whatsappConfigGet,
  'whatsapp-connect': whatsappConnect,
  'whatsapp-disconnect': whatsappDisconnect,
  'whatsapp-worker': whatsappWorker,
  'whatsapp-webhook': whatsappWebhook,
  'team-list': teamList,
  'team-invite': teamInvite,
  'team-accept': teamAccept,
  'team-role': teamRole,
  'team-revoke': teamRevoke,
  'reorder-reminder-create': reorderReminderCreate,
  'reorder-reminder-open': reorderReminderOpen,
  'analytics-ingest': analyticsIngest,
  'analytics-consent': analyticsConsent,
  'api-key-create': apiKeyCreate,
  'api-key-list': apiKeyList,
  'api-key-revoke': apiKeyRevoke,
  'api-v1': apiV1,
  'api-webhook-create': apiWebhookCreate,
  'api-webhook-list': apiWebhookList,
  'api-webhook-revoke': apiWebhookRevoke,
  'api-webhook-worker': apiWebhookWorker,
}

const port = Number(Deno.env.get('EDGE_PORT') ?? '8000')

Deno.serve({ port, hostname: '127.0.0.1' }, (request) => {
  const path = new URL(request.url).pathname
  if (path === '/health') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (path.startsWith('/api-v1')) return apiV1(request)

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
