#!/usr/bin/env node
/**
 * Executa os handlers reais das Edge Functions públicas em Deno local,
 * contra PostgREST + Postgres reais. Sem Supabase Cloud, Asaas ou Auth Cloud.
 *
 * Cobre: catálogo, pedido, idempotência, honeypot, rate limit, recompra,
 * link revogado, catálogo indisponível e CORS.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const BOOTSTRAP = join(ROOT, 'supabase', 'tests', '00_bootstrap.sql')
const NETWORK = `pedeoutra-edge-${process.pid}`
const PG_CONTAINER = `pedeoutra-edge-db-${process.pid}`
const REST_CONTAINER = `pedeoutra-edge-rest-${process.pid}`
const PG_IMAGE = 'postgres:17-alpine'
const REST_IMAGE = 'public.ecr.aws/supabase/postgrest:v16.4'
const DB_NAME = 'pedeoutra_edge'
const JWT_SECRET = 'pedeoutra-edge-secret-with-at-least-32-characters'
const USER_ID = 'eeeeeeee-1111-4111-8111-111111111111'
const ADMIN_ID = 'eeeeeeee-9999-4999-8999-999999999999'
const ORG_ID = 'eeeeeeee-2222-4222-8222-222222222222'
const ORG_SLUG = 'distribuidora-edge-abc123'
const PRODUCT_1 = 'eeeeeeee-3333-4333-8333-333333333333'
const PRODUCT_2 = 'eeeeeeee-4444-4444-8444-444444444444'
const PRODUCT_INACTIVE = 'eeeeeeee-5555-4555-8555-555555555555'
const CUSTOMER_ID = 'eeeeeeee-6666-4666-8666-666666666666'
const LINK_ID = 'eeeeeeee-7777-4777-8777-777777777777'
const CATEGORY_ID = 'eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REORDER_TOKEN = Buffer.from(
  Array.from({ length: 32 }, (_, index) => (index * 37 + 11) % 256),
).toString('base64url')
const REORDER_TOKEN_HASH = createHash('sha256').update(REORDER_TOKEN).digest('hex')

let passed = 0
let failed = 0
const failures = []

function ok(name) {
  passed += 1
  console.log(`  PASS  ${name}`)
}

async function test(name, fn) {
  try {
    await fn()
    ok(name)
  } catch (error) {
    failed += 1
    failures.push({ name, error })
    console.log(`  FAIL  ${name}: ${error.message}`)
  }
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

function clientQuery(sql) {
  const result = docker(
    ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  )
  return result.stdout
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
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

function signJwt(payload, expiresInSeconds = 3600) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  )
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

async function waitForSql() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const result = docker(
      ['exec', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c', 'select 1'],
      { allowFailure: true },
    )
    if (result.status === 0 && result.stdout.trim() === '1') return
    await sleep(500)
  }
  throw new Error('Postgres não ficou pronto')
}

function applyFile(path) {
  const sql = readFileSync(path, 'utf8')
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8' },
    )
    if (result.status === 0) return
    const error = `${result.stderr}${result.stdout}`
    if (!/shutting down|starting up|connection to server|could not connect/i.test(error)) {
      throw new Error(`Falha ao aplicar ${path}: ${error}`)
    }
    spawnSync('sleep', ['1'])
  }
  throw new Error(`Banco não estabilizou para ${path}`)
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // subindo
    }
    await sleep(250)
  }
  throw new Error(`${url} não ficou pronto`)
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

const SEED_SQL = `
insert into auth.users (id, email) values
  ('${USER_ID}', 'edge@example.test'),
  ('${ADMIN_ID}', 'admin@example.test');

insert into public.platform_admins (singleton, user_id) values (true, '${ADMIN_ID}');

insert into public.organizations (id, owner_user_id, name, slug, whatsapp, city)
values (
  '${ORG_ID}', '${USER_ID}', 'Distribuidora Edge', '${ORG_SLUG}',
  '11999998888', 'São Paulo'
);

insert into public.product_categories (id, organization_id, name, slug, position)
values ('${CATEGORY_ID}', '${ORG_ID}', 'Bebidas', 'bebidas', 1);

insert into public.products (id, organization_id, name, unit, price_cents, active, category_id, sku)
values
  ('${PRODUCT_1}', '${ORG_ID}', 'Copo 200ml', 'cento', 1250, true, '${CATEGORY_ID}', 'COPO-200'),
  ('${PRODUCT_2}', '${ORG_ID}', 'Água 5L', 'galão', 899, true, null, null),
  ('${PRODUCT_INACTIVE}', '${ORG_ID}', 'Item pausado', 'un', 500, false, null, null);

insert into public.customers (id, organization_id, display_name, contact_phone)
values ('${CUSTOMER_ID}', '${ORG_ID}', 'Padaria Edge', '11977776666');

insert into public.reorder_links (
  id, organization_id, customer_id, token_hash, template_json, expires_at, created_by
) values (
  '${LINK_ID}', '${ORG_ID}', '${CUSTOMER_ID}', '${REORDER_TOKEN_HASH}',
  '[{"product_id":"${PRODUCT_1}","quantity":2}]'::jsonb,
  now() + interval '60 days', '${USER_ID}'
);
`

async function main() {
  const restPort = await findFreePort()
  const proxyPort = await findFreePort()
  const edgePort = await findFreePort()
  const restBase = `http://127.0.0.1:${restPort}`
  const proxyBase = `http://127.0.0.1:${proxyPort}`
  const edgeBase = `http://127.0.0.1:${edgePort}`
  let proxy = null
  console.log(`PedeOutra Edge HTTP test — PostgREST ${restBase}, Deno ${edgeBase}`)

  docker(['network', 'create', NETWORK], { allowFailure: true })
  docker([
    'run', '--rm', '-d',
    '--name', PG_CONTAINER,
    '--network', NETWORK,
    '--network-alias', 'db',
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', `POSTGRES_DB=${DB_NAME}`,
    PG_IMAGE,
  ])

  const serviceToken = signJwt({ role: 'service_role', sub: USER_ID })
  const deno = denoCommand()
  let edgeProcess = null

  try {
    await waitForSql()
    console.log('[1/5] Migrations e seed')
    applyFile(BOOTSTRAP)
    for (const file of readdirSync(MIGRATIONS_DIR).filter((item) => item.endsWith('.sql')).sort()) {
      applyFile(join(MIGRATIONS_DIR, file))
      console.log(`  applied ${file}`)
    }
    const seed = spawnSync(
      'docker',
      ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1'],
      { input: SEED_SQL, encoding: 'utf8' },
    )
    if (seed.status !== 0) throw new Error(`seed: ${seed.stderr}`)

    console.log('[2/5] PostgREST em /rest/v1')
    docker([
      'run', '--rm', '-d',
      '--name', REST_CONTAINER,
      '--network', NETWORK,
      '-p', `127.0.0.1:${restPort}:3000`,
      '-e', `PGRST_DB_URI=postgres://postgres:postgres@db:5432/${DB_NAME}`,
      '-e', 'PGRST_DB_SCHEMAS=public',
      '-e', 'PGRST_DB_ANON_ROLE=anon',
      '-e', `PGRST_JWT_SECRET=${JWT_SECRET}`,
      '-e', 'PGRST_SERVER_PORT=3000',
      '-e', 'PGRST_LOG_LEVEL=error',
      REST_IMAGE,
    ])
    await waitFor(`${restBase}/`)

    // supabase-js chama /rest/v1; encaminha para o PostgREST, que serve na raiz.
    const userToken = signJwt({ role: 'authenticated', sub: USER_ID })
    const adminToken = signJwt({
      role: 'authenticated',
      sub: ADMIN_ID,
      aal: 'aal2',
      amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }],
    })
    const adminAal1Token = signJwt({ role: 'authenticated', sub: ADMIN_ID })
    const supplierAal2Token = signJwt({
      role: 'authenticated',
      sub: USER_ID,
      aal: 'aal2',
      amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }],
    })
    const expiredAdminToken = signJwt(
      {
        role: 'authenticated',
        sub: ADMIN_ID,
        aal: 'aal2',
        amr: [{ method: 'totp' }],
      },
      -3600,
    )
    const authUsers = new Map([
      [
        `Bearer ${userToken}`,
        { id: USER_ID, email: 'edge@example.test', role: 'authenticated', aud: 'authenticated' },
      ],
      [
        `Bearer ${adminToken}`,
        { id: ADMIN_ID, email: 'admin@example.test', role: 'authenticated', aud: 'authenticated' },
      ],
      [
        `Bearer ${adminAal1Token}`,
        { id: ADMIN_ID, email: 'admin@example.test', role: 'authenticated', aud: 'authenticated' },
      ],
      [
        `Bearer ${supplierAal2Token}`,
        { id: USER_ID, email: 'edge@example.test', role: 'authenticated', aud: 'authenticated' },
      ],
      [`Bearer ${expiredAdminToken}`, null],
    ])
    proxy = createHttpServer((request, response) => {
      const url = request.url ?? '/'
      if (url.startsWith('/auth/v1/user')) {
        const authorization = request.headers.authorization ?? ''
        const user = authUsers.get(authorization)
        if (!user) {
          response.writeHead(401, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ message: 'invalid jwt' }))
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(user))
        return
      }
      if (!url.startsWith('/rest/v1')) {
        response.writeHead(404)
        response.end()
        return
      }
      const path = url.slice('/rest/v1'.length) || '/'
      const upstream = httpRequest(
        {
          host: '127.0.0.1',
          port: restPort,
          path,
          method: request.method,
          headers: { ...request.headers, host: `127.0.0.1:${restPort}` },
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
    await new Promise((resolveListen, rejectListen) => {
      proxy.on('error', rejectListen)
      proxy.listen(proxyPort, '127.0.0.1', resolveListen)
    })

    console.log('[3/5] Router Deno com handlers reais')
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
          SUPABASE_ANON_KEY: signJwt({ role: 'anon', sub: USER_ID }),
          SUPABASE_SERVICE_ROLE_KEY: serviceToken,
          APP_ORIGIN: 'http://127.0.0.1:5173',
          APP_URL: 'http://127.0.0.1:5173',
          ADMIN_EMAIL: 'admin@example.test',
          ADMIN_BOOTSTRAP_TOKEN: 'bootstrap-test-token',
          EDGE_PORT: String(edgePort),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32' && deno.command.endsWith('.cmd'),
      },
    )
    let edgeOutput = ''
    edgeProcess.stdout?.on('data', (chunk) => {
      edgeOutput += String(chunk)
    })
    edgeProcess.stderr?.on('data', (chunk) => {
      edgeOutput += String(chunk)
    })
    try {
      await waitFor(`${edgeBase}/health`)
    } catch (error) {
      console.error(`EDGE OUTPUT:\n${edgeOutput}`)
      throw error
    }
    console.log('  router pronto')

    async function call(name, body, options = {}) {
      const method = options.method ?? 'POST'
      const headers = {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers ?? {}),
      }
      const response = await fetch(`${edgeBase}/${name}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body),
      })
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
      return { status: response.status, data, headers: response.headers }
    }

    console.log('[4/5] Catálogo, pedido e anti-spam')
    await test('catálogo público só com produtos ativos e CORS', async () => {
      const response = await fetch(`${edgeBase}/public-catalog?slug=${ORG_SLUG}`, {
        headers: { Origin: 'http://127.0.0.1:5173' },
      })
      const data = await response.json()
      assert(response.status === 200, `HTTP ${response.status}`)
      assert(data.organization.name === 'Distribuidora Edge', 'nome')
      assert(data.products.length === 2, `esperava 2 ativos, veio ${data.products.length}`)
      assert(
        !data.products.some((item) => item.id === PRODUCT_INACTIVE),
        'produto inativo exposto',
      )
      assert(data.accepting_orders === true, 'deveria aceitar pedidos')
      assert(data.categories.length === 1, 'categoria pública ausente')
      assert(data.categories[0].name === 'Bebidas', 'nome da categoria')
      const categorized = data.products.find((item) => item.id === PRODUCT_1)
      assert(categorized.category_id === CATEGORY_ID, 'produto sem categoria')
      assert(categorized.sku === 'COPO-200', 'SKU público')
      assert(Array.isArray(categorized.images), 'images ausente')
      assert(
        response.headers.get('access-control-allow-origin') === 'http://127.0.0.1:5173',
        'CORS',
      )
    })

    await test('slug inválido retorna 400', async () => {
      const response = await fetch(`${edgeBase}/public-catalog?slug=../x`)
      assert(response.status === 400, `HTTP ${response.status}`)
    })

    const requestId = 'eeeeeeee-8888-4888-8888-888888888888'
    let firstOrder
    await test('pedido público cria pedido e total server-side', async () => {
      const response = await call('public-order', {
        slug: ORG_SLUG,
        buyer_name: 'Padaria Edge',
        buyer_phone: '11977776666',
        note: 'Teste Edge',
        items: [{ product_id: PRODUCT_1, quantity: 2 }],
        company_website: '',
        elapsed_ms: 2000,
        consent: true,
        request_id: requestId,
      })
      assert(response.status === 201, `HTTP ${response.status} ${JSON.stringify(response.data)}`)
      assert(response.data.total_cents === 2500, `total ${response.data.total_cents}`)
      firstOrder = response.data
    })

    await test('request_id repetido não duplica pedido', async () => {
      const response = await call('public-order', {
        slug: ORG_SLUG,
        buyer_name: 'Padaria Edge',
        buyer_phone: '11977776666',
        items: [{ product_id: PRODUCT_1, quantity: 2 }],
        company_website: '',
        elapsed_ms: 2000,
        consent: true,
        request_id: requestId,
      })
      assert(response.status === 201, `HTTP ${response.status}`)
      assert(
        response.data.public_reference === firstOrder.public_reference,
        'referência deveria ser a mesma',
      )
      const count = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select count(*) from public.orders where request_id = '${requestId}'`,
      ])
      assert(count.stdout.trim() === '1', `pedidos com mesmo request_id: ${count.stdout}`)
    })

    await test('quantidade inválida é rejeitada', async () => {
      const response = await call('public-order', {
        slug: ORG_SLUG,
        buyer_name: 'Padaria Edge',
        buyer_phone: '11977776666',
        items: [{ product_id: PRODUCT_1, quantity: 1000 }],
        company_website: '',
        elapsed_ms: 2000,
        consent: true,
        request_id: crypto.randomUUID(),
      })
      assert(response.status === 400, `HTTP ${response.status}`)
    })

    await test('honeypot é rejeitado', async () => {
      const response = await call('public-order', {
        slug: ORG_SLUG,
        buyer_name: 'Padaria Edge',
        buyer_phone: '11977776666',
        items: [{ product_id: PRODUCT_1, quantity: 1 }],
        company_website: 'spam',
        elapsed_ms: 2000,
        consent: true,
        request_id: crypto.randomUUID(),
      })
      assert(response.status === 400 && response.data.error === 'spam_detected', 'honeypot')
    })

    console.log('[5/5] Recompra, revogação e rate limit')
    await test('reorder-get não expõe PII', async () => {
      const response = await call('reorder-get', { token: REORDER_TOKEN })
      assert(response.status === 200, `HTTP ${response.status}`)
      assert(response.data.items[0].quantity === 2, 'quantidade')
      const text = JSON.stringify(response.data)
      assert(!text.includes('Padaria Edge'), 'nome do cliente vazou')
      assert(!text.includes('11977776666'), 'telefone vazou')
      assert(response.data.catalog_url, 'catalog_url')
    })

    await test('reorder-submit cria pedido com preço atual', async () => {
      const response = await call('reorder-submit', {
        token: REORDER_TOKEN,
        items: [{ product_id: PRODUCT_1, quantity: 3 }],
        company_website: '',
        elapsed_ms: 2000,
        request_id: crypto.randomUUID(),
      })
      assert(response.status === 201, `HTTP ${response.status} ${JSON.stringify(response.data)}`)
      assert(response.data.total_cents === 3750, `total ${response.data.total_cents}`)
    })

    await test('token desconhecido falha de forma neutra', async () => {
      const response = await call('reorder-get', { token: 'A'.repeat(43) })
      assert(response.status === 404, `HTTP ${response.status}`)
      assert(response.data.error === 'link_unavailable', 'erro neutro')
    })

    await test('link revogado retorna 410 com catálogo', async () => {
      docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-c',
        `update public.reorder_links set revoked_at = now() where id = '${LINK_ID}'`,
      ])
      const response = await call('reorder-get', { token: REORDER_TOKEN })
      assert(response.status === 410, `HTTP ${response.status}`)
      assert(response.data.catalog_url, 'catálogo alternativo')
    })

    await test('rate limit bloqueia excesso de pedidos', async () => {
      const statuses = []
      for (let index = 0; index < 22; index += 1) {
        const response = await call('public-order', {
          slug: ORG_SLUG,
          buyer_name: 'Padaria Edge',
          buyer_phone: '11977776666',
          items: [{ product_id: PRODUCT_2, quantity: 1 }],
          company_website: '',
          elapsed_ms: 2000,
          consent: true,
          request_id: crypto.randomUUID(),
        })
        statuses.push(response.status)
      }
      assert(statuses.includes(429), `nenhum 429 em ${statuses.join(',')}`)
    })

    await test('preflight CORS responde 204', async () => {
      const response = await fetch(`${edgeBase}/public-order`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://127.0.0.1:5173' },
      })
      assert(response.status === 204, `HTTP ${response.status}`)
      assert(
        response.headers.get('access-control-allow-origin') === 'http://127.0.0.1:5173',
        'CORS origin',
      )
      const allowedHeaders = response.headers.get('access-control-allow-headers') ?? ''
      assert(allowedHeaders.includes('apikey'), 'CORS deve permitir apikey')
      assert(allowedHeaders.includes('authorization'), 'CORS deve permitir authorization')
    })

    console.log('[6/6] Funções autenticadas (stub GoTrue)')
    let createdLink
    await test('link-order-customer autenticado vincula cliente', async () => {
      const orderRow = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select id from public.orders where public_reference = '${firstOrder.public_reference}'`,
      ]).stdout.trim()
      assert(orderRow, 'pedido não encontrado')
      const response = await call(
        'link-order-customer',
        { order_id: orderRow },
        { token: userToken },
      )
      assert(response.status === 200, `HTTP ${response.status} ${JSON.stringify(response.data)}`)
      assert(response.data.customer_id, 'customer_id')
    })

    await test('reorder-create autenticado emite link', async () => {
      const customerRow = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select id from public.customers where organization_id = '${ORG_ID}'`,
      ]).stdout.trim()
      assert(customerRow, 'cliente não encontrado')
      const response = await call(
        'reorder-create',
        { customer_id: customerRow },
        { token: userToken },
      )
      assert(response.status === 201, `HTTP ${response.status} ${JSON.stringify(response.data)}`)
      assert(response.data.url, 'url')
      createdLink = response.data
    })

    await test('reorder-revoke autenticado revoga link', async () => {
      const response = await call(
        'reorder-revoke',
        { link_id: createdLink.link_id },
        { token: userToken },
      )
      assert(response.status === 200, `HTTP ${response.status} ${JSON.stringify(response.data)}`)
      assert(response.data.revoked === true, 'revoked')
    })

    await test('create-checkout retorna PROD BLOCKED sem credenciais', async () => {
      const response = await call('create-checkout', {}, { token: userToken })
      assert(response.status === 503, `HTTP ${response.status}`)
      assert(response.data.error === 'billing_not_configured', 'erro de billing')
    })

    await test('cancel-subscription retorna PROD BLOCKED sem credenciais', async () => {
      const response = await call('cancel-subscription', {}, { token: userToken })
      assert(response.status === 503, `HTTP ${response.status}`)
      assert(response.data.error === 'billing_not_configured', 'erro de billing')
    })

    console.log('[7/8] Planos, checkout e console admin')

    await test('plan-catalog expõe dois planos e mantém Pro indisponível', async () => {
      const response = await fetch(`${edgeBase}/plan-catalog`)
      const data = await response.json()
      assert(response.status === 200, `HTTP ${response.status}`)
      assert(data.plans.length === 2, `planos: ${data.plans.length}`)
      const essential = data.plans.find((plan) => plan.plan_code === 'essential')
      const professional = data.plans.find((plan) => plan.plan_code === 'professional')
      assert(essential.price_cents === 2990, 'preço Essencial')
      assert(essential.available === true, 'Essencial deveria estar disponível')
      assert(professional.price_cents === 6990, 'preço Profissional')
      assert(professional.available === false, 'Profissional não pode ser vendido nesta fase')
      assert(
        professional.unavailable_reason === 'PRO_PLAN_CHECKOUT_DISABLED',
        professional.unavailable_reason,
      )
    })

    await test('create-checkout recusa Profissional antes de chamar o Asaas', async () => {
      const response = await call(
        'create-checkout',
        { plan_code: 'professional' },
        { token: userToken },
      )
      assert(response.status === 409, `HTTP ${response.status}`)
      assert(response.data.error === 'plan_not_available', 'erro de plano')
    })

    await test('admin-api rejeita anônimo, AAL1, fornecedor e token expirado', async () => {
      const anonymous = await fetch(`${edgeBase}/admin-api?view=overview`)
      assert(anonymous.status === 401, `anônimo HTTP ${anonymous.status}`)

      const aal1 = await fetch(`${edgeBase}/admin-api?view=overview`, {
        headers: { Authorization: `Bearer ${adminAal1Token}` },
      })
      assert(aal1.status === 403, `AAL1 HTTP ${aal1.status}`)

      const supplier = await fetch(`${edgeBase}/admin-api?view=overview`, {
        headers: { Authorization: `Bearer ${supplierAal2Token}` },
      })
      assert(supplier.status === 403, `fornecedor HTTP ${supplier.status}`)

      const expired = await fetch(`${edgeBase}/admin-api?view=overview`, {
        headers: { Authorization: `Bearer ${expiredAdminToken}` },
      })
      assert(expired.status === 401, `expirado HTTP ${expired.status}`)
    })

    await test('admin-api AAL2 retorna overview, lista paginada e auditoria', async () => {
      const overviewResponse = await fetch(`${edgeBase}/admin-api?view=overview`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const overview = await overviewResponse.json()
      assert(overviewResponse.status === 200, `HTTP ${overviewResponse.status}`)
      assert(overview.overview.organizations_total >= 1, 'total de organizações')

      const listResponse = await fetch(
        `${edgeBase}/admin-api?view=organizations&limit=1&offset=0`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      )
      const list = await listResponse.json()
      assert(listResponse.status === 200, `HTTP ${listResponse.status}`)
      assert(list.organizations.length === 1, `lista ${list.organizations.length}`)
      assert(list.total >= 1, 'total da paginação')
      assert(!('owner_email' in list.organizations[0]), 'PII desnecessária no admin')

      const auditResponse = await fetch(`${edgeBase}/admin-api?view=audit`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const audit = await auditResponse.json()
      assert(auditResponse.status === 200, `HTTP ${auditResponse.status}`)
      assert(Array.isArray(audit.audit), 'auditoria')
    })

    await test('admin-bootstrap exige token dedicado e e-mail do ambiente', async () => {
      const okResponse = await call(
        'admin-bootstrap',
        {},
        {
          token: adminToken,
          headers: { 'x-admin-bootstrap-token': 'bootstrap-test-token' },
        },
      )
      assert(
        okResponse.status === 201,
        `HTTP ${okResponse.status} ${JSON.stringify(okResponse.data)}`,
      )
      assert(okResponse.data.bootstrapped === true, 'bootstrap')

      const wrongEmail = await call(
        'admin-bootstrap',
        {},
        {
          token: supplierAal2Token,
          headers: { 'x-admin-bootstrap-token': 'bootstrap-test-token' },
        },
      )
      assert(wrongEmail.status === 403, `e-mail divergente HTTP ${wrongEmail.status}`)

      const wrongToken = await call(
        'admin-bootstrap',
        {},
        {
          token: adminToken,
          headers: { 'x-admin-bootstrap-token': 'token-errado' },
        },
      )
      assert(wrongToken.status === 401, `token errado HTTP ${wrongToken.status}`)
    })

    await test('admin-bootstrap falha fechado sem ADMIN_EMAIL', async () => {
      const noAdminPort = await findFreePort()
      const noAdminBase = `http://127.0.0.1:${noAdminPort}`
      const env = {
        ...process.env,
        SUPABASE_URL: proxyBase,
        SUPABASE_ANON_KEY: signJwt({ role: 'anon', sub: USER_ID }),
        SUPABASE_SERVICE_ROLE_KEY: serviceToken,
        APP_ORIGIN: 'http://127.0.0.1:5173',
        APP_URL: 'http://127.0.0.1:5173',
        EDGE_PORT: String(noAdminPort),
      }
      delete env.ADMIN_EMAIL
      delete env.ADMIN_BOOTSTRAP_TOKEN
      const processNoAdmin = spawn(
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
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32' && deno.command.endsWith('.cmd'),
        },
      )
      try {
        await waitFor(`${noAdminBase}/health`)
        const response = await fetch(`${noAdminBase}/admin-bootstrap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
            'x-admin-bootstrap-token': 'bootstrap-test-token',
          },
          body: '{}',
        })
        const data = await response.json()
        assert(response.status === 503, `HTTP ${response.status}`)
        assert(
          data.error === 'ADMIN_BOOTSTRAP_BLOCKED',
          `erro ${JSON.stringify(data)}`,
        )
      } finally {
        if (processNoAdmin.exitCode === null) {
          if (process.platform === 'win32' && processNoAdmin.pid) {
            // Caminho absoluto evita depender de PATH; /T encerra o shell e o
            // processo Deno neto iniciado via npx.
            spawnSync(
              String.raw`C:\Windows\System32\taskkill.exe`,
              ['/pid', String(processNoAdmin.pid), '/T', '/F'],
              { stdio: 'ignore' },
            )
          } else {
            processNoAdmin.kill('SIGTERM')
          }
        }
      }
    })

    await test('change-plan bloqueia troca sem caminho seguro e registra intenção', async () => {
      await clientQuery(`
        insert into public.subscriptions
          (organization_id, state, current_period_end, plan_code, plan_version)
        values ('${ORG_ID}', 'active', now() + interval '20 days', 'professional', 1)
        on conflict (organization_id) do update
          set state = 'active',
              current_period_end = now() + interval '20 days',
              plan_code = 'professional',
              plan_version = 1
      `)
      const response = await call(
        'change-plan',
        { plan_code: 'essential' },
        { token: userToken },
      )
      assert(response.status === 409, `HTTP ${response.status}`)
      assert(response.data.error === 'plan_change_requires_support', 'erro de troca')
      assert(response.data.support_required === true, 'suporte')
      const changes = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select status from public.plan_changes where organization_id = '${ORG_ID}' order by created_at desc limit 1`,
      ]).stdout.trim()
      assert(changes === 'blocked', `status da troca: ${changes}`)
      await clientQuery(`delete from public.subscriptions where organization_id = '${ORG_ID}'`)
    })

    await test('ações admin são auditadas e reativam o acesso', async () => {
      const suspend = await call(
        'admin-api',
        {
          action: 'org.suspend',
          organization_id: ORG_ID,
          reason: 'teste de suspensão administrativa',
        },
        { token: adminToken },
      )
      assert(suspend.status === 200, `suspender HTTP ${suspend.status}`)
      assert(suspend.data.result === 'blocked', 'estado bloqueado')

      const reactivate = await call(
        'admin-api',
        {
          action: 'org.reactivate',
          organization_id: ORG_ID,
          reason: 'teste de reativação administrativa',
        },
        { token: adminToken },
      )
      assert(reactivate.status === 200, `reativar HTTP ${reactivate.status}`)
      assert(reactivate.data.result === 'trial', 'estado trial')

      const audit = await fetch(`${edgeBase}/admin-api?view=audit`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const data = await audit.json()
      const actions = new Set(data.audit.map((event) => event.action))
      assert(data.audit.length >= 3, `audit default limit: ${data.audit.length}`)
      assert(actions.has('admin.org.suspend'), 'auditoria de suspensão')
      assert(actions.has('admin.org.reactivate'), 'auditoria de reativação')
    })


    console.log('[8/8] Categorias e mídia')

    await test('product-image-list exige sessão e retorna lista vazia', async () => {
      const anonymous = await fetch(`${edgeBase}/product-image-list`)
      assert(anonymous.status === 401 || anonymous.status === 403, `anônimo ${anonymous.status}`)
      const response = await fetch(`${edgeBase}/product-image-list`, {
        headers: { Authorization: `Bearer ${userToken}` },
      })
      const data = await response.json()
      assert(response.status === 200, `HTTP ${response.status}`)
      assert(Array.isArray(data.images) && data.images.length === 0, 'lista deveria estar vazia')
    })

    await test('upload de mídia rejeita formulário inválido e SVG', async () => {
      const invalidForm = await call('product-image-upload', {}, { token: userToken })
      assert(invalidForm.status === 400, `form HTTP ${invalidForm.status}`)

      const form = new FormData()
      form.append('product_id', PRODUCT_1)
      form.append('alt_text', 'Copo de teste')
      form.append(
        'image',
        new Blob([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')], {
          type: 'image/svg+xml',
        }),
        'malicioso.svg',
      )
      const response = await fetch(`${edgeBase}/product-image-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: form,
      })
      const data = await response.json()
      assert(response.status === 400, `SVG HTTP ${response.status}`)
      assert(data.error === 'invalid_image', `erro ${JSON.stringify(data)}`)
    })

    await test('delete e capa de mídia validam o id', async () => {
      const deleteResponse = await call(
        'product-image-delete',
        { image_id: 'inválido' },
        { token: userToken },
      )
      assert(deleteResponse.status === 400, `delete HTTP ${deleteResponse.status}`)
      const coverResponse = await call(
        'product-image-cover',
        { image_id: 'inválido' },
        { token: userToken },
      )
      assert(coverResponse.status === 400, `cover HTTP ${coverResponse.status}`)
    })

    console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`)
    if (failed > 0) {
      for (const { name, error } of failures) console.error(`  - ${name}: ${error.message}`)
      console.error(edgeOutput.slice(-2000))
      process.exitCode = 1
    }
  } finally {
    if (proxy) proxy.close()
    if (edgeProcess && edgeProcess.exitCode === null) {
      if (process.platform === 'win32' && edgeProcess.pid) {
        spawnSync('taskkill', ['/pid', String(edgeProcess.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        edgeProcess.kill('SIGTERM')
      }
    }
    docker(['rm', '-f', REST_CONTAINER], { allowFailure: true })
    docker(['rm', '-f', PG_CONTAINER], { allowFailure: true })
    docker(['network', 'rm', NETWORK], { allowFailure: true })
  }
}

main().catch((error) => {
  console.error(error)
  docker(['rm', '-f', REST_CONTAINER], { allowFailure: true })
  docker(['rm', '-f', PG_CONTAINER], { allowFailure: true })
  docker(['network', 'rm', NETWORK], { allowFailure: true })
  process.exit(1)
})
