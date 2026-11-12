#!/usr/bin/env node
/**
 * Integração local ponta a ponta contra `supabase start` + `supabase functions serve`.
 * Não usa credenciais de nuvem nem Asaas real.
 *
 * Pré-requisitos:
 *   supabase start
 *   supabase functions serve --env-file supabase/functions/.env.local --no-verify-jwt
 *
 * Uso: npm run test:local
 */
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const EMAIL = `e2e+${Date.now()}@example.test`
const PASSWORD = 'Teste123!seguro'
const ORG_NAME = `Distribuidora E2E ${Date.now()}`

function readLocalStatus() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return {
      url: process.env.SUPABASE_URL.replace(/\/+$/, ''),
      anonKey: process.env.SUPABASE_ANON_KEY,
    }
  }

  const raw = execSync('supabase status -o env', { encoding: 'utf8' })
  const values = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (match) values[match[1]] = match[2]
  }

  const url = values.API_URL ?? values.SUPABASE_URL ?? 'http://127.0.0.1:54421'
  const anonKey = values.ANON_KEY ?? values.SUPABASE_ANON_KEY
  if (!anonKey) throw new Error('ANON_KEY não encontrada no supabase status')
  return { url: url.replace(/\/+$/, ''), anonKey }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function callEdge(baseUrl, anonKey, name, body, accessToken = null) {
  const response = await fetch(`${baseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken ?? anonKey}`,
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

async function main() {
  const { url, anonKey } = readLocalStatus()
  console.log(`Integração local em ${url}`)

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log('[1/7] Auth e organização')
  const { data: signUp, error: signUpError } = await supabase.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
  })
  assert(!signUpError, `signup: ${signUpError?.message}`)
  assert(signUp.session, 'signup deveria retornar sessão (confirmações desativadas)')
  const accessToken = signUp.session.access_token
  const userId = signUp.user.id

  const { data: organization, error: orgError } = await supabase.rpc('create_organization', {
    p_name: ORG_NAME,
    p_whatsapp: '11999998888',
    p_city: 'São Paulo',
  })
  assert(!orgError, `create_organization: ${orgError?.message}`)
  assert(organization.slug, 'organização sem slug')
  assert(organization.trial_ends_at, 'trial_ends_at ausente')
  console.log(`  PASS organização ${organization.slug}`)

  console.log('[2/7] Produtos e clientes via PostgREST + RLS')
  const { data: product, error: productError } = await supabase
    .from('products')
    .insert({
      organization_id: organization.id,
      name: 'Copo descartável 200ml',
      unit: 'cento',
      price_cents: 1250,
    })
    .select('*')
    .single()
  assert(!productError, `insert produto: ${productError?.message}`)

  const { error: customerError } = await supabase
    .from('customers')
    .insert({
      organization_id: organization.id,
      display_name: 'Padaria E2E',
      contact_phone: '11977776666',
    })
    .select('*')
    .single()
  assert(!customerError, `insert cliente: ${customerError?.message}`)
  console.log('  PASS produto e cliente criados')

  console.log('[3/7] Catálogo público')
  const catalogResponse = await fetch(
    `${url}/functions/v1/public-catalog?slug=${encodeURIComponent(organization.slug)}`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  const catalog = await catalogResponse.json()
  assert(catalogResponse.ok, `catálogo: HTTP ${catalogResponse.status}`)
  assert(catalog.organization?.name === ORG_NAME, 'nome do fornecedor divergente')
  assert(
    catalog.products?.some((item) => item.id === product.id),
    'produto ativo ausente no catálogo',
  )
  console.log('  PASS catálogo público com 1 produto')

  console.log('[4/7] Pedido público')
  const orderResponse = await callEdge(url, anonKey, 'public-order', {
    slug: organization.slug,
    buyer_name: 'Padaria E2E',
    buyer_phone: '11977776666',
    note: 'Pedido de integração local',
    items: [{ product_id: product.id, quantity: 2 }],
    company_website: '',
    elapsed_ms: 2500,
    consent: true,
    request_id: crypto.randomUUID(),
  })
  assert(orderResponse.status === 201, `public-order: HTTP ${orderResponse.status}`)
  assert(orderResponse.payload.public_reference, 'referência pública ausente')
  assert(orderResponse.payload.total_cents === 2500, 'total deveria ser 2500')
  console.log(`  PASS pedido ${orderResponse.payload.public_reference}`)

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('public_reference', orderResponse.payload.public_reference)
    .single()
  assert(!orderError && order, `pedido não encontrado: ${orderError?.message}`)

  console.log('[5/7] Vinculação a cliente e link de recompra')
  const linkCustomer = await callEdge(
    url,
    anonKey,
    'link-order-customer',
    { order_id: order.id },
    accessToken,
  )
  assert(linkCustomer.status === 200, `link-order-customer: HTTP ${linkCustomer.status}`)
  assert(linkCustomer.payload.customer_id, 'customer_id ausente')

  const reorder = await callEdge(
    url,
    anonKey,
    'reorder-create',
    { customer_id: linkCustomer.payload.customer_id },
    accessToken,
  )
  assert(reorder.status === 201, `reorder-create: HTTP ${reorder.status}`)
  assert(reorder.payload.url, 'URL de recompra ausente')
  const token = new URL(reorder.payload.url).pathname.split('/').pop()
  assert(token && token.length === 43, 'token de recompra inválido')
  console.log('  PASS link de recompra emitido')

  console.log('[6/7] Resolver e reenviar recompra')
  const reorderGet = await callEdge(url, anonKey, 'reorder-get', { token })
  assert(reorderGet.status === 200, `reorder-get: HTTP ${reorderGet.status}`)
  assert(reorderGet.payload.items?.[0]?.quantity === 2, 'quantidade da recompra divergente')
  assert(!JSON.stringify(reorderGet.payload).includes('Padaria E2E'), 'PII vazou no link')
  assert(!JSON.stringify(reorderGet.payload).includes('11977776666'), 'telefone vazou no link')

  const reorderSubmit = await callEdge(url, anonKey, 'reorder-submit', {
    token,
    items: [{ product_id: product.id, quantity: 3 }],
    company_website: '',
    elapsed_ms: 2000,
    request_id: crypto.randomUUID(),
  })
  assert(reorderSubmit.status === 201, `reorder-submit: HTTP ${reorderSubmit.status}`)
  assert(reorderSubmit.payload.total_cents === 3750, 'total de recompra deveria ser 3750')
  console.log(`  PASS recompra ${reorderSubmit.payload.public_reference}`)

  console.log('[7/7] Revogação e billing bloqueado')
  const revoke = await callEdge(
    url,
    anonKey,
    'reorder-revoke',
    { link_id: reorder.payload.link_id },
    accessToken,
  )
  assert(revoke.status === 200, `reorder-revoke: HTTP ${revoke.status}`)

  const revokedGet = await callEdge(url, anonKey, 'reorder-get', { token })
  assert(revokedGet.status === 410, `link revogado deveria retornar 410, veio ${revokedGet.status}`)
  assert(revokedGet.payload.catalog_url, 'link revogado deveria oferecer catálogo')

  const checkout = await callEdge(url, anonKey, 'create-checkout', {}, accessToken)
  assert(
    checkout.status === 503 && checkout.payload.error === 'billing_not_configured',
    `create-checkout deveria estar bloqueado, veio ${checkout.status} ${checkout.payload.error}`,
  )
  console.log('  PASS link revogado e billing PROD BLOCKED')

  console.log('\nPASS integração local completa')
  console.log(`  usuário=${userId} org=${organization.id}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
