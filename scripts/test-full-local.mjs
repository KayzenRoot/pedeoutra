#!/usr/bin/env node
/**
 * E2E local completo, sem credenciais de nuvem:
 * Postgres + GoTrue real + PostgREST + Edge Functions (Deno) + Asaas mock.
 *
 * Cobre: signup/login real, organização, produto, catálogo, pedido, vínculo de
 * cliente, recompra, revogação, checkout, webhook idempotente, valor adulterado,
 * cancelamento, reembolso, bloqueio de acesso e reconciliação.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ROOT = resolve(import.meta.dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const BOOTSTRAP = join(ROOT, 'supabase', 'tests', '00_bootstrap.sql')
const NETWORK = `pedeoutra-full-${process.pid}`
const PG = `pedeoutra-full-pg-${process.pid}`
const GOTRUE = `pedeoutra-full-auth-${process.pid}`
const REST = `pedeoutra-full-rest-${process.pid}`
const DB_NAME = 'pedeoutra_full'
const JWT_SECRET = 'pedeoutra-full-local-secret-with-32-chars'
const WEBHOOK_TOKEN = 'test-webhook-token'
const RECONCILE_TOKEN = 'test-reconcile-token'
const EMAIL = `full+${Date.now()}@example.test`
const PASSWORD = 'Teste123!seguro'

let passed = 0
let failed = 0
const failures = []

function ok(name) {
  passed += 1
  console.log(`  PASS  ${name}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options })
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker ${args.join(' ')} falhou: ${result.stderr || result.stdout}`)
  }
  return result
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function signJwt(payload) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }),
  )
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

async function waitForHttp(url, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return response
    } catch {
      // subindo
    }
    await sleep(250)
  }
  throw new Error(`${url} não ficou pronto`)
}

async function waitForSql() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker(
      ['exec', PG, 'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c', 'select 1'],
      { allowFailure: true },
    )
    if (result.status === 0 && result.stdout.trim() === '1') return
    await sleep(500)
  }
  throw new Error('Postgres não ficou pronto')
}

async function applyFile(path) {
  const sql = readFileSync(path, 'utf8')
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['exec', '-i', PG, 'psql', '-U', 'postgres', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8' },
    )
    if (result.status === 0) return
    const error = `${result.stderr}${result.stdout}`
    if (!/shutting down|starting up|connection to server|could not connect/i.test(error)) {
      throw new Error(`Falha ao aplicar ${path}: ${error}`)
    }
    await sleep(1000)
  }
  throw new Error(`Banco não estabilizou para ${path}`)
}

async function applySql(sql) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', PG, 'psql', '-U', 'postgres', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error(`SQL falhou: ${result.stderr}`)
}

function denoCommand() {
  const local = spawnSync('deno', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (local.status === 0) return { command: 'deno', prefix: [] }
  return process.platform === 'win32'
    ? { command: 'npx.cmd', prefix: ['-y', 'deno'] }
    : { command: 'npx', prefix: ['-y', 'deno'] }
}

function startProxy(port, routes) {
  const server = createHttpServer((request, response) => {
    const url = request.url ?? '/'
    const route = routes.find((candidate) => url.startsWith(candidate.prefix))
    if (!route) {
      response.writeHead(404)
      response.end()
      return
    }

    const path = url.slice(route.prefix.length) || '/'
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: route.port,
        path,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${route.port}` },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      },
    )
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    request.pipe(upstream)
  })

  return new Promise((resolveListen, rejectListen) => {
    server.on('error', rejectListen)
    server.listen(port, '127.0.0.1', () => resolveListen(server))
  })
}

function startAsaasMock(port) {
  let checkoutExternalReference = null
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }

    if (request.method === 'POST' && url.pathname === '/v3/checkouts') {
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          checkoutExternalReference = parsed.externalReference
        } catch {
          checkoutExternalReference = null
        }
        send(200, {
          id: 'chk_mock',
          link: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_mock',
          status: 'ACTIVE',
        })
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v3/checkouts/chk_mock') {
      send(200, {
        id: 'chk_mock',
        status: 'PAID',
        externalReference: checkoutExternalReference,
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v3/subscriptions/sub_mock') {
      send(200, {
        id: 'sub_mock',
        status: 'ACTIVE',
        nextDueDate: '2026-12-12',
        externalReference: checkoutExternalReference,
        value: 29.9,
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v3/payments/pay_ok') {
      send(200, {
        id: 'pay_ok',
        status: 'RECEIVED',
        subscription: 'sub_mock',
        externalReference: checkoutExternalReference,
        value: 29.9,
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v3/payments/pay_bad') {
      send(200, {
        id: 'pay_bad',
        status: 'RECEIVED',
        subscription: 'sub_mock',
        externalReference: checkoutExternalReference,
        value: 10.0,
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v3/payments/pay_refund') {
      send(200, {
        id: 'pay_refund',
        status: 'REFUNDED',
        subscription: 'sub_mock',
        externalReference: checkoutExternalReference,
        value: 29.9,
      })
      return
    }

    if (request.method === 'DELETE' && url.pathname === '/v3/subscriptions/sub_mock') {
      send(200, { deleted: true })
      return
    }

    send(404, { errors: [{ description: 'not_found' }] })
  })

  return new Promise((resolveListen, rejectListen) => {
    server.on('error', rejectListen)
    server.listen(port, '127.0.0.1', () => resolveListen(server))
  })
}

async function main() {
  const pgPort = await findFreePort()
  const authPort = await findFreePort()
  const restPort = await findFreePort()
  const proxyPort = await findFreePort()
  const edgePort = await findFreePort()
  const asaasPort = await findFreePort()

  const proxyBase = `http://127.0.0.1:${proxyPort}`
  const edgeBase = `http://127.0.0.1:${edgePort}`
  console.log(`PedeOutra FULL local E2E — proxy ${proxyBase}`)

  let proxyServer = null
  let asaasServer = null
  let edgeProcess = null
  let edgeOutput = ''

  docker(['network', 'create', NETWORK], { allowFailure: true })
  docker([
    'run', '--rm', '-d',
    '--name', PG,
    '--network', NETWORK,
    '--network-alias', 'db',
    '-p', `127.0.0.1:${pgPort}:5432`,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', `POSTGRES_DB=${DB_NAME}`,
    'postgres:17-alpine',
  ])

  try {
    await waitForSql()
    await applySql('create schema if not exists auth;')

    console.log('[1/7] GoTrue real')
    docker([
      'run', '--rm', '-d',
      '--name', GOTRUE,
      '--network', NETWORK,
      '-p', `127.0.0.1:${authPort}:9999`,
      '-e', 'GOTRUE_API_HOST=0.0.0.0',
      '-e', 'PORT=9999',
      '-e', `API_EXTERNAL_URL=${proxyBase}`,
      '-e', 'GOTRUE_DB_DRIVER=postgres',
      '-e', `GOTRUE_DB_DATABASE_URL=postgres://postgres:postgres@db:5432/${DB_NAME}?search_path=auth`,
      '-e', 'GOTRUE_SITE_URL=http://127.0.0.1:5173',
      '-e', `GOTRUE_JWT_SECRET=${JWT_SECRET}`,
      '-e', 'GOTRUE_JWT_EXP=3600',
      '-e', 'GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated',
      '-e', 'GOTRUE_MAILER_AUTOCONFIRM=true',
      '-e', 'GOTRUE_DISABLE_SIGNUP=false',
      '-e', 'GOTRUE_LOG_LEVEL=error',
      'public.ecr.aws/supabase/gotrue:v2.197.0',
    ])
    await waitForHttp(`http://127.0.0.1:${authPort}/health`)
    ok('GoTrue saudável')

    console.log('[2/7] Bootstrap, migrations e PostgREST')
    await applyFile(BOOTSTRAP)
    for (const file of readdirSync(MIGRATIONS_DIR).filter((item) => item.endsWith('.sql')).sort()) {
      await applyFile(join(MIGRATIONS_DIR, file))
      console.log(`  applied ${file}`)
    }

    docker([
      'run', '--rm', '-d',
      '--name', REST,
      '--network', NETWORK,
      '-p', `127.0.0.1:${restPort}:3000`,
      '-e', `PGRST_DB_URI=postgres://postgres:postgres@db:5432/${DB_NAME}`,
      '-e', 'PGRST_DB_SCHEMAS=public',
      '-e', 'PGRST_DB_ANON_ROLE=anon',
      '-e', `PGRST_JWT_SECRET=${JWT_SECRET}`,
      '-e', 'PGRST_SERVER_PORT=3000',
      '-e', 'PGRST_LOG_LEVEL=error',
      'public.ecr.aws/supabase/postgrest:v16.4',
    ])
    await waitForHttp(`http://127.0.0.1:${restPort}/`)
    ok('PostgREST saudável')

    console.log('[3/7] Proxy, Asaas mock e roteador Deno')
    asaasServer = await startAsaasMock(asaasPort)
    proxyServer = await startProxy(proxyPort, [
      { prefix: '/auth/v1', port: authPort },
      { prefix: '/rest/v1', port: restPort },
      { prefix: '/functions/v1', port: edgePort },
    ])

    const serviceToken = signJwt({ role: 'service_role' })
    const anonToken = signJwt({ role: 'anon' })
    const deno = denoCommand()
    edgeProcess = spawn(
      deno.command,
      [
        ...deno.prefix,
        'run',
        '--allow-net',
        '--allow-env',
        '--allow-read',
        'scripts/local-edge-router.ts',
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          SUPABASE_URL: proxyBase,
          SUPABASE_ANON_KEY: anonToken,
          SUPABASE_SERVICE_ROLE_KEY: serviceToken,
          APP_ORIGIN: 'http://127.0.0.1:5173',
          APP_URL: 'http://127.0.0.1:5173',
          EDGE_PORT: String(edgePort),
          ASAAS_API_KEY: 'mock-key',
          ASAAS_API_BASE_URL: `http://127.0.0.1:${asaasPort}`,
          ASAAS_CHECKOUT_BASE_URL: 'https://sandbox.asaas.com',
          ASAAS_WEBHOOK_TOKEN: WEBHOOK_TOKEN,
          BILLING_RECONCILE_TOKEN: RECONCILE_TOKEN,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32' && deno.command.endsWith('.cmd'),
      },
    )
    edgeProcess.stdout?.on('data', (chunk) => {
      edgeOutput += String(chunk)
    })
    edgeProcess.stderr?.on('data', (chunk) => {
      edgeOutput += String(chunk)
    })
    await waitForHttp(`${edgeBase}/health`)
    await waitForHttp(`${proxyBase}/functions/v1/health`)
    ok('proxy e roteador prontos')

    console.log('[4/7] Supabase Auth real (signup/login)')
    const admin = createClient(proxyBase, serviceToken, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const client = createClient(proxyBase, anonToken, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const signUp = await client.auth.signUp({ email: EMAIL, password: PASSWORD })
    assert(!signUp.error, `signup: ${signUp.error?.message}`)
    assert(signUp.data.session, 'signup deveria retornar sessão')
    const accessToken = signUp.data.session.access_token
    const decoded = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString())
    assert(decoded.role === 'authenticated', `JWT role=${decoded.role}`)

    const login = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
    assert(!login.error, `login: ${login.error?.message}`)
    assert(login.data.session?.access_token, 'login deveria retornar sessão')

    const user = await client.auth.getUser(accessToken)
    assert(user.data.user?.email === EMAIL, 'getUser não retornou o usuário')
    ok('signup/login/GoTrue getUser reais')

    console.log('[5/7] Organização, produto e pedido')
    const orgResult = await client.rpc('create_organization', {
      p_name: 'Distribuidora Full E2E',
      p_whatsapp: '11999998888',
      p_city: 'São Paulo',
    })
    assert(!orgResult.error, `create_organization: ${orgResult.error?.message}`)
    const organization = orgResult.data
    assert(organization.slug, 'slug ausente')

    const productResult = await client
      .from('products')
      .insert({
        organization_id: organization.id,
        name: 'Copo Full 200ml',
        unit: 'cento',
        price_cents: 1250,
      })
      .select('*')
      .single()
    assert(!productResult.error, `product: ${productResult.error?.message}`)
    const product = productResult.data

    const catalogResponse = await fetch(
      `${proxyBase}/functions/v1/public-catalog?slug=${organization.slug}`,
      { headers: { apikey: anonToken, Authorization: `Bearer ${anonToken}` } },
    )
    const catalog = await catalogResponse.json()
    assert(catalogResponse.ok, `catálogo: HTTP ${catalogResponse.status}`)
    assert(catalog.products.some((item) => item.id === product.id), 'produto ausente')

    const orderResponse = await fetch(`${proxyBase}/functions/v1/public-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonToken,
        Authorization: `Bearer ${anonToken}`,
      },
      body: JSON.stringify({
        slug: organization.slug,
        buyer_name: 'Padaria Full',
        buyer_phone: '11977776666',
        note: 'E2E full',
        items: [{ product_id: product.id, quantity: 2 }],
        company_website: '',
        elapsed_ms: 2000,
        consent: true,
        request_id: crypto.randomUUID(),
      }),
    })
    const orderPayload = await orderResponse.json()
    assert(orderResponse.status === 201, `order: HTTP ${orderResponse.status} ${JSON.stringify(orderPayload)}`)
    assert(orderPayload.total_cents === 2500, 'total')

    const { data: order } = await client
      .from('orders')
      .select('*')
      .eq('public_reference', orderPayload.public_reference)
      .single()
    assert(order?.id, 'pedido não encontrado via RLS')

    const linkCustomer = await invoke(client, 'link-order-customer', { order_id: order.id })
    assert(linkCustomer.status === 200, `link-order-customer: ${linkCustomer.status}`)
    ok('organização, produto, catálogo, pedido e vínculo reais')

    console.log('[6/7] Recompra real')
    const reorderCreate = await invoke(client, 'reorder-create', {
      customer_id: linkCustomer.data.customer_id,
    })
    assert(reorderCreate.status === 200, `reorder-create: ${reorderCreate.status}`)
    const reorderToken = new URL(reorderCreate.data.url).pathname.split('/').pop()

    const reorderGet = await publicCall(proxyBase, anonToken, 'reorder-get', {
      token: reorderToken,
    })
    assert(reorderGet.status === 200, `reorder-get: ${reorderGet.status}`)
    assert(reorderGet.data.items[0].quantity === 2, 'quantidade')
    assert(!JSON.stringify(reorderGet.data).includes('Padaria Full'), 'PII vazou')

    const reorderSubmit = await publicCall(proxyBase, anonToken, 'reorder-submit', {
      token: reorderToken,
      items: [{ product_id: product.id, quantity: 3 }],
      company_website: '',
      elapsed_ms: 2000,
      request_id: crypto.randomUUID(),
    })
    assert(reorderSubmit.status === 201, `reorder-submit: ${reorderSubmit.status}`)
    assert(reorderSubmit.data.total_cents === 3750, 'total recompra')

    const revoke = await invoke(client, 'reorder-revoke', {
      link_id: reorderCreate.data.link_id,
    })
    assert(revoke.status === 200, `reorder-revoke: ${revoke.status}`)
    const revokedGet = await publicCall(proxyBase, anonToken, 'reorder-get', {
      token: reorderToken,
    })
    assert(revokedGet.status === 410, `revogado: ${revokedGet.status}`)
    ok('recompra, PII, revogação reais')

    console.log('[7/7] Billing real com Asaas mock')
    const checkout = await invoke(client, 'create-checkout', {})
    assert(checkout.status === 200, `create-checkout: ${checkout.status} ${JSON.stringify(checkout.data)}`)
    assert(checkout.data.price_cents === 2990, 'preço')
    assert(checkout.data.checkout_url.includes('chk_mock'), 'checkout url')

    let subscription = await client
      .from('subscriptions')
      .select('*')
      .eq('organization_id', organization.id)
      .single()
    assert(subscription.data?.state === 'pending', `estado ${subscription.data?.state}`)

    const noToken = await fetch(`${proxyBase}/functions/v1/asaas-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert(noToken.status === 401, `webhook sem token: ${noToken.status}`)

    const paid = await webhook(proxyBase, {
      id: 'evt_full_paid_1',
      event: 'CHECKOUT_PAID',
      dateCreated: '2026-11-12 20:00:00',
      checkout: {
        id: 'chk_mock',
        status: 'PAID',
        externalReference: organization.id,
        subscription: { id: 'sub_mock', cycle: 'MONTHLY', nextDueDate: '2026-12-12' },
        items: [{ value: 29.9, quantity: 1 }],
      },
    })
    assert(paid.status === 200, `webhook paid: ${paid.status}`)
    subscription = await client
      .from('subscriptions')
      .select('*')
      .eq('organization_id', organization.id)
      .single()
    assert(subscription.data?.state === 'active', `estado pós-pago ${subscription.data?.state}`)
    assert(subscription.data?.provider_subscription_id === 'sub_mock', 'subscription id')

    const duplicate = await webhook(proxyBase, {
      id: 'evt_full_paid_1',
      event: 'CHECKOUT_PAID',
      dateCreated: '2026-11-12 20:00:00',
      checkout: {
        id: 'chk_mock',
        status: 'PAID',
        externalReference: organization.id,
        subscription: { id: 'sub_mock', cycle: 'MONTHLY', nextDueDate: '2026-12-12' },
        items: [{ value: 29.9, quantity: 1 }],
      },
    })
    assert(duplicate.status === 200 && duplicate.data.duplicate === true, 'duplicado')
    const eventCount = await admin
      .from('billing_events')
      .select('id', { count: 'exact', head: true })
      .eq('provider_event_id', 'evt_full_paid_1')
    assert(eventCount.count === 1, `eventos: ${eventCount.count}`)

    const bad = await webhook(proxyBase, {
      id: 'evt_full_bad_1',
      event: 'PAYMENT_RECEIVED',
      dateCreated: '2026-11-12 20:01:00',
      payment: {
        id: 'pay_bad',
        subscription: 'sub_mock',
        value: 10.0,
        status: 'RECEIVED',
        externalReference: organization.id,
      },
    })
    assert(bad.status === 200, `webhook bad: ${bad.status}`)
    await sleep(300)
    const badEvent = await admin
      .from('billing_events')
      .select('*')
      .eq('provider_event_id', 'evt_full_bad_1')
      .single()
    assert(badEvent.data?.state === 'failed', `bad state ${badEvent.data?.state}`)
    assert(badEvent.data?.error === 'amount_mismatch', `bad error ${badEvent.data?.error}`)
    subscription = await client
      .from('subscriptions')
      .select('*')
      .eq('organization_id', organization.id)
      .single()
    assert(subscription.data?.state === 'active', 'valor adulterado não pode mudar estado')

    const cancel = await invoke(client, 'cancel-subscription', {})
    assert(cancel.status === 200, `cancel: ${cancel.status}`)
    subscription = await client
      .from('subscriptions')
      .select('*')
      .eq('organization_id', organization.id)
      .single()
    assert(subscription.data?.state === 'canceled', `cancel state ${subscription.data?.state}`)

    const refund = await webhook(proxyBase, {
      id: 'evt_full_refund_1',
      event: 'PAYMENT_REFUNDED',
      dateCreated: '2026-11-12 20:02:00',
      payment: {
        id: 'pay_refund',
        subscription: 'sub_mock',
        value: 29.9,
        status: 'REFUNDED',
        externalReference: organization.id,
      },
    })
    assert(refund.status === 200, `refund: ${refund.status}`)
    subscription = await client
      .from('subscriptions')
      .select('*')
      .eq('organization_id', organization.id)
      .single()
    assert(subscription.data?.state === 'refunded', `refund state ${subscription.data?.state}`)

    // Política: reembolso revoga o acesso pago, mas não encurta um trial ainda
    // vigente. Para provar o bloqueio, o trial é expirado antes da tentativa.
    const expireTrial = await admin
      .from('organizations')
      .update({ trial_ends_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', organization.id)
    assert(!expireTrial.error, `expire trial: ${expireTrial.error?.message}`)

    const blockedWrite = await client.from('products').insert({
      organization_id: organization.id,
      name: 'Bloqueado',
      unit: 'un',
    })
    assert(Boolean(blockedWrite.error), 'escrita deveria ser bloqueada após reembolso')

    const reconcile = await fetch(`${proxyBase}/functions/v1/billing-reconcile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reconcile-token': RECONCILE_TOKEN,
      },
      body: '{}',
    })
    assert(reconcile.status === 200, `reconcile: ${reconcile.status}`)
    ok('checkout, webhook, duplicado, valor, cancelamento, reembolso e reconcile')

    console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`)
    if (failed > 0) {
      for (const { name, error } of failures) console.error(`  - ${name}: ${error.message}`)
      console.error(edgeOutput.slice(-3000))
      process.exitCode = 1
    }
  } finally {
    if (proxyServer) proxyServer.close()
    if (asaasServer) asaasServer.close()
    if (edgeProcess && edgeProcess.exitCode === null) {
      if (process.platform === 'win32' && edgeProcess.pid) {
        spawnSync('taskkill', ['/pid', String(edgeProcess.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        edgeProcess.kill('SIGTERM')
      }
    }
    docker(['rm', '-f', GOTRUE], { allowFailure: true })
    docker(['rm', '-f', REST], { allowFailure: true })
    docker(['rm', '-f', PG], { allowFailure: true })
    docker(['network', 'rm', NETWORK], { allowFailure: true })
  }
}

async function publicCall(baseUrl, anonToken, name, body) {
  const response = await fetch(`${baseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonToken,
      Authorization: `Bearer ${anonToken}`,
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  return { status: response.status, data }
}

async function invoke(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (!error) return { status: 200, data }
  const context = error.context
  if (context) {
    const payload = await context.json().catch(() => ({}))
    return { status: context.status, data: payload }
  }
  return { status: 500, data: { error: error.message } }
}

async function webhook(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/functions/v1/asaas-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'asaas-access-token': WEBHOOK_TOKEN,
    },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  return { status: response.status, data }
}

main().catch((error) => {
  console.error(error)
  docker(['rm', '-f', GOTRUE], { allowFailure: true })
  docker(['rm', '-f', REST], { allowFailure: true })
  docker(['rm', '-f', PG], { allowFailure: true })
  docker(['network', 'rm', NETWORK], { allowFailure: true })
  process.exit(1)
})
