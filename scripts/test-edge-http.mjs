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
const INVITEE_ID = 'eeeeeeee-aaaa-4aaa-8aaa-cccccccccccc'
const ORG_ID = 'eeeeeeee-2222-4222-8222-222222222222'
const ORG_SLUG = 'distribuidora-edge-abc123'
const PRODUCT_1 = 'eeeeeeee-3333-4333-8333-333333333333'
const PRODUCT_2 = 'eeeeeeee-4444-4444-8444-444444444444'
const PRODUCT_INACTIVE = 'eeeeeeee-5555-4555-8555-555555555555'
const CUSTOMER_ID = 'eeeeeeee-6666-4666-8666-666666666666'
const LINK_ID = 'eeeeeeee-7777-4777-8777-777777777777'
const PRICE_LIST_ID = 'eeeeeeee-aaaa-4aaa-8aaa-bbbbbbbbbbbb'
const CUSTOMER_NO_LIST_ID = 'eeeeeeee-9999-4999-8999-aaaaaaaaaaaa'
const CATEGORY_ID = 'eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REORDER_TOKEN = Buffer.from(
  Array.from({ length: 32 }, (_, index) => (index * 37 + 11) % 256),
).toString('base64url')
const REORDER_TOKEN_HASH = createHash('sha256').update(REORDER_TOKEN).digest('hex')
const PRICE_TOKEN = Buffer.from(
  Array.from({ length: 32 }, (_, index) => (index * 53 + 7) % 256),
).toString('base64url')
const PRICE_TOKEN_HASH = createHash('sha256').update(PRICE_TOKEN).digest('hex')
const WHATSAPP_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => (index * 29 + 3) % 256)).toString('base64')
const WHATSAPP_WEBHOOK_SECRET = 'whatsapp-webhook-test-secret'
const WHATSAPP_WORKER_TOKEN = 'whatsapp-worker-test-token'

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
insert into auth.users (id, email, email_confirmed_at) values
  ('${USER_ID}', 'edge@example.test', now()),
  ('${ADMIN_ID}', 'admin@example.test', now()),
  ('${INVITEE_ID}', 'edge-invitee@example.test', now());

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
values
  ('${CUSTOMER_ID}', '${ORG_ID}', 'Padaria Edge', '11977776666'),
  ('${CUSTOMER_NO_LIST_ID}', '${ORG_ID}', 'Mercado Sem Lista', '11966665555');

insert into public.price_lists (id, organization_id, name)
values ('${PRICE_LIST_ID}', '${ORG_ID}', 'Tabela Ouro Edge');

insert into public.price_list_items
  (organization_id, price_list_id, product_id, price_cents, valid_from)
values ('${ORG_ID}', '${PRICE_LIST_ID}', '${PRODUCT_1}', 1000, now() - interval '1 day');

insert into public.customer_price_list_assignments
  (organization_id, customer_id, price_list_id)
values ('${ORG_ID}', '${CUSTOMER_ID}', '${PRICE_LIST_ID}');

insert into public.customer_price_tokens
  (organization_id, customer_id, token_hash, expires_at, created_by)
values (
  '${ORG_ID}', '${CUSTOMER_ID}', '${PRICE_TOKEN_HASH}',
  now() + interval '60 days', '${USER_ID}'
);

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
    const inviteeToken = signJwt({ role: 'authenticated', sub: INVITEE_ID })
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
        `Bearer ${inviteeToken}`,
        { id: INVITEE_ID, email: 'edge-invitee@example.test', role: 'authenticated', aud: 'authenticated' },
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
          WHATSAPP_ENCRYPTION_KEY: WHATSAPP_KEY,
          WHATSAPP_WEBHOOK_SECRET,
          WHATSAPP_WORKER_TOKEN,
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
      const response = await call(
        'reorder-create',
        { customer_id: CUSTOMER_ID },
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


    await test('product-import faz dry-run, commit e retry idempotente', async () => {
      const rows = [
        {
          line: 2,
          name: 'Produto Import Edge',
          sku: 'IMP-EDGE',
          category: 'Nova Categoria',
          unit: 'un',
          price_cents: 500,
          active: true,
          min_quantity: 1,
          quantity_increment: 1,
          action: 'auto',
        },
        {
          line: 3,
          name: 'Copo Edge Atualizado',
          sku: 'COPO-200',
          category: 'Bebidas',
          unit: 'cento',
          price_cents: 1300,
          active: true,
          min_quantity: 1,
          quantity_increment: 1,
          action: 'auto',
        },
      ]
      const dry = await call('product-import', { mode: 'dry_run', rows }, { token: userToken })
      assert(dry.status === 200, `dry HTTP ${dry.status} ${JSON.stringify(dry.data)}`)
      assert(dry.data.summary.creates === 1, `creates ${dry.data.summary.creates}`)
      assert(dry.data.summary.updates === 1, `updates ${dry.data.summary.updates}`)
      assert(dry.data.summary.errors === 0, `errors ${dry.data.summary.errors}`)

      const jobId = crypto.randomUUID()
      const commit = await call(
        'product-import',
        { mode: 'commit', job_id: jobId, rows },
        { token: userToken },
      )
      assert(commit.status === 200, `commit HTTP ${commit.status} ${JSON.stringify(commit.data)}`)
      assert(commit.data.summary.created_count === 1, 'created_count')
      assert(commit.data.summary.updated_count === 1, 'updated_count')

      const retry = await call(
        'product-import',
        { mode: 'commit', job_id: jobId, rows },
        { token: userToken },
      )
      assert(retry.status === 200, `retry HTTP ${retry.status}`)
      assert(retry.data.summary.created_count === 1, 'retry não idempotente')
      const count = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select count(*) from public.products where organization_id = '${ORG_ID}' and sku = 'IMP-EDGE'`,
      ]).stdout.trim()
      assert(count === '1', `produto duplicado: ${count}`)
    })

    await test('product-import bloqueia linha inválida antes do commit', async () => {
      const invalid = await call(
        'product-import',
        {
          mode: 'dry_run',
          rows: [
            {
              line: 2,
              name: '<script>alert(1)</script>',
              sku: 'BAD-1',
              unit: 'un',
              price_cents: 100,
              active: true,
              min_quantity: 1,
              quantity_increment: 1,
              action: 'auto',
            },
          ],
        },
        { token: userToken },
      )
      assert(invalid.status === 200, `dry HTTP ${invalid.status}`)
      assert(invalid.data.summary.errors === 1, 'erro não detectado')
      const commit = await call(
        'product-import',
        {
          mode: 'commit',
          job_id: crypto.randomUUID(),
          rows: [
            {
              line: 2,
              name: '<script>alert(1)</script>',
              sku: 'BAD-1',
              unit: 'un',
              price_cents: 100,
              active: true,
              min_quantity: 1,
              quantity_increment: 1,
              action: 'auto',
            },
          ],
        },
        { token: userToken },
      )
      assert(commit.status === 400, `commit HTTP ${commit.status}`)
      assert(commit.data.error === 'import_validation_failed', 'erro de validação')
    })


    await test('catalog-templates expõe cinco modelos sem preço', async () => {
      const response = await fetch(`${edgeBase}/catalog-templates`)
      const data = await response.json()
      assert(response.status === 200, `HTTP ${response.status}`)
      assert(data.templates.length === 5, `templates ${data.templates.length}`)
      const packaging = data.templates.find((template) => template.code === 'packaging')
      assert(packaging.items.length > 0, 'template packaging vazio')
      assert(!('price_cents' in packaging.items[0]), 'template não deve ter preço')
      const empty = data.templates.find((template) => template.code === 'empty')
      assert(empty.items.length === 0, 'template vazio')
    })

    await test('onboarding-seed valida, cria e é idempotente', async () => {
      const items = [
        {
          item_key: 'copo-200',
          name: 'Copo descartável 200ml',
          category: 'Copos e potes',
          unit: 'cento',
          min_quantity: 1,
          quantity_increment: 1,
        },
        {
          item_key: 'sacola',
          name: 'Sacola plástica reforçada',
          category: 'Sacolas e sacos',
          unit: 'pacote',
          min_quantity: 1,
          quantity_increment: 1,
        },
      ]
      const preview = await call(
        'onboarding-seed',
        { mode: 'preview', template_code: 'packaging', template_version: 1, items },
        { token: userToken },
      )
      assert(preview.status === 200, `preview HTTP ${preview.status}`)
      assert(preview.data.summary.conflicts === 0, 'preview deveria estar sem conflito')

      const jobId = crypto.randomUUID()
      const commit = await call(
        'onboarding-seed',
        {
          mode: 'commit',
          job_id: jobId,
          template_code: 'packaging',
          template_version: 1,
          items,
        },
        { token: userToken },
      )
      assert(commit.status === 200, `commit HTTP ${commit.status}`)
      assert(commit.data.summary.created_count === 2, 'created_count')
      const retry = await call(
        'onboarding-seed',
        {
          mode: 'commit',
          job_id: jobId,
          template_code: 'packaging',
          template_version: 1,
          items,
        },
        { token: userToken },
      )
      assert(retry.data.summary.created_count === 2, 'retry não idempotente')

      const after = await call(
        'onboarding-seed',
        { mode: 'preview', template_code: 'packaging', template_version: 1, items },
        { token: userToken },
      )
      assert(after.data.summary.conflicts === 2, 'conflito pós-seed não detectado')
      const price = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select price_cents from public.products where organization_id = '${ORG_ID}' and name = 'Copo descartável 200ml'`,
      ]).stdout.trim()
      assert(price === '', `template inventou preço: ${price}`)
    })

    await test('onboarding-seed rejeita item fora do template', async () => {
      const response = await call(
        'onboarding-seed',
        {
          mode: 'preview',
          template_code: 'packaging',
          template_version: 1,
          items: [
            {
              item_key: 'inventado',
              name: 'Produto inventado',
              category: 'X',
              unit: 'un',
              min_quantity: 1,
              quantity_increment: 1,
            },
          ],
        },
        { token: userToken },
      )
      assert(response.status === 400, `HTTP ${response.status}`)
      assert(response.data.error === 'invalid_seed_items', 'erro de item inválido')
    })


    await test('order-tracking cria, resolve sem PII e revoga', async () => {
      const orderId = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select id from public.orders where public_reference = '${firstOrder.public_reference}'`,
      ]).stdout.trim()
      assert(orderId, 'pedido público não encontrado')

      const created = await call(
        'order-tracking-create',
        { order_id: orderId },
        { token: userToken },
      )
      assert(created.status === 201, `create HTTP ${created.status}`)
      assert(created.data.url.includes('/acompanhar/'), 'url de acompanhamento')
      const token = created.data.url.split('/').pop()

      const response = await fetch(
        `${edgeBase}/order-tracking-get?token=${encodeURIComponent(token)}`,
      )
      const data = await response.json()
      assert(response.status === 200, `get HTTP ${response.status}`)
      assert(data.reference === firstOrder.public_reference, 'referência')
      assert(data.items.length >= 1, 'itens resumidos')
      assert(Array.isArray(data.timeline), 'timeline')
      const serialized = JSON.stringify(data)
      assert(!serialized.includes('Padaria Edge'), 'nome do comprador vazou')
      assert(!serialized.includes('11977776666'), 'telefone do comprador vazou')
      assert(response.headers.get('x-robots-tag')?.includes('noindex'), 'noindex')

      const revoked = await call(
        'order-tracking-revoke',
        { order_id: orderId },
        { token: userToken },
      )
      assert(revoked.status === 200, `revoke HTTP ${revoked.status}`)
      const afterRevoke = await fetch(
        `${edgeBase}/order-tracking-get?token=${encodeURIComponent(token)}`,
      )
      assert(afterRevoke.status === 404, `revogado HTTP ${afterRevoke.status}`)
    })

    await test('order-tracking falha neutro para token inválido/expirado e outro tenant', async () => {
      const invalid = await fetch(`${edgeBase}/order-tracking-get?token=${'x'.repeat(43)}`)
      assert(invalid.status === 404, `inválido HTTP ${invalid.status}`)

      const orderId = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select id from public.orders where public_reference = '${firstOrder.public_reference}'`,
      ]).stdout.trim()
      const created = await call(
        'order-tracking-create',
        { order_id: orderId },
        { token: userToken },
      )
      const token = created.data.url.split('/').pop()
      docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-c',
        `update public.order_tracking_links set created_at = now() - interval '40 days', expires_at = now() - interval '10 days' where order_id = '${orderId}'`,
      ])
      const expired = await fetch(
        `${edgeBase}/order-tracking-get?token=${encodeURIComponent(token)}`,
      )
      assert(expired.status === 404, `expirado HTTP ${expired.status}`)

      const other = await call(
        'order-tracking-create',
        { order_id: crypto.randomUUID() },
        { token: userToken },
      )
      assert(other.status === 404, `outro tenant HTTP ${other.status}`)
    })


    console.log('[9/9] Preços por comprador')

    await test('private-catalog exige plano, aplica preço privado e não vaza PII', async () => {
      const denied = await fetch(
        `${edgeBase}/private-catalog-get?token=${encodeURIComponent(PRICE_TOKEN)}`,
      )
      assert(denied.status === 404, `sem plano HTTP ${denied.status}`)

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

      const invalidOrder = await call('public-order', {
        slug: ORG_SLUG,
        items: [{ product_id: PRODUCT_1, quantity: 1 }],
        company_website: '',
        elapsed_ms: 2000,
        consent: true,
        request_id: crypto.randomUUID(),
        price_token: 'x'.repeat(43),
      }, { headers: { 'x-forwarded-for': '203.0.113.11' } })
      assert(invalidOrder.status === 404, `token inválido HTTP ${invalidOrder.status}`)
      assert(invalidOrder.data.error === 'price_link_unavailable', 'erro de link inválido')

      const response = await fetch(
        `${edgeBase}/private-catalog-get?token=${encodeURIComponent(PRICE_TOKEN)}`,
      )
      const data = await response.json()
      assert(response.status === 200, `HTTP ${response.status} ${JSON.stringify(data)}`)
      assert(data.customer.name === 'Padaria Edge', 'cliente do link')
      assert(data.price_list.name === 'Tabela Ouro Edge', 'tabela aplicada')
      const privateProduct = data.products.find((product) => product.id === PRODUCT_1)
      const publicProduct = data.products.find((product) => product.id === PRODUCT_2)
      assert(privateProduct.price_cents === 1000, `preço privado ${privateProduct.price_cents}`)
      assert(privateProduct.price_source === 'private', 'origem privada')
      assert(publicProduct.price_cents === 899, `fallback ${publicProduct.price_cents}`)
      assert(publicProduct.price_source === 'public', 'origem pública')
      const serialized = JSON.stringify(data)
      assert(!serialized.includes('11977776666'), 'telefone do cliente vazou')
      assert(response.headers.get('x-robots-tag')?.includes('noindex'), 'noindex')
      assert(response.headers.get('referrer-policy') === 'no-referrer', 'no-referrer')
    })

    await test('pedido privado usa token, não exige nome/telefone e preserva origem', async () => {
      const orderRequest = crypto.randomUUID()
      const response = await call('public-order', {
        slug: ORG_SLUG,
        note: 'Pedido com tabela privada',
        items: [{ product_id: PRODUCT_1, quantity: 1 }],
        company_website: '',
        elapsed_ms: 2000,
        consent: true,
        request_id: orderRequest,
        price_token: PRICE_TOKEN,
      }, { headers: { 'x-forwarded-for': '203.0.113.10' } })
      assert(response.status === 201, `HTTP ${response.status} ${JSON.stringify(response.data)}`)
      assert(response.data.total_cents === 1000, `total ${response.data.total_cents}`)

      const order = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-F', '|', '-c',
        `select customer_id, buyer_name, buyer_phone, source, price_source, price_list_id
           from public.orders where request_id = '${orderRequest}'`,
      ]).stdout.trim()
      const [customerId, buyerName, buyerPhone, source, priceSource, priceListId] =
        order.split('|')
      assert(customerId === CUSTOMER_ID, `cliente ${customerId}`)
      assert(buyerName === '' && buyerPhone === '', 'PII do comprador foi persistida')
      assert(source === 'private', `source ${source}`)
      assert(priceSource === 'private', `price_source ${priceSource}`)
      assert(priceListId === PRICE_LIST_ID, `price_list ${priceListId}`)
    })

    await test('link de preço exige tabela, expõe catálogo e revoga', async () => {
      const missing = await call(
        'customer-price-link-create',
        { customer_id: CUSTOMER_NO_LIST_ID },
        { token: userToken },
      )
      assert(missing.status === 409, `sem tabela HTTP ${missing.status}`)
      assert(missing.data.error === 'price_list_required', 'erro de tabela')

      const created = await call(
        'customer-price-link-create',
        { customer_id: CUSTOMER_ID },
        { token: userToken },
      )
      assert(created.status === 201, `create HTTP ${created.status} ${JSON.stringify(created.data)}`)
      assert(created.data.url.includes('/p/'), 'url privada')
      const token = created.data.url.split('/').pop()

      const response = await fetch(
        `${edgeBase}/private-catalog-get?token=${encodeURIComponent(token)}`,
      )
      assert(response.status === 200, `get HTTP ${response.status}`)

      await clientQuery(`
        delete from public.customer_price_list_assignments
         where organization_id = '${ORG_ID}' and customer_id = '${CUSTOMER_ID}'
      `)
      const withoutList = await fetch(
        `${edgeBase}/private-catalog-get?token=${encodeURIComponent(token)}`,
      )
      assert(withoutList.status === 404, `sem tabela HTTP ${withoutList.status}`)
      await clientQuery(`
        insert into public.customer_price_list_assignments
          (organization_id, customer_id, price_list_id)
        values ('${ORG_ID}', '${CUSTOMER_ID}', '${PRICE_LIST_ID}')
      `)

      const revoked = await call(
        'customer-price-link-revoke',
        { customer_id: CUSTOMER_ID },
        { token: userToken },
      )
      assert(revoked.status === 200, `revoke HTTP ${revoked.status}`)
      assert(revoked.data.revoked >= 1, 'nenhum token revogado')
      const after = await fetch(
        `${edgeBase}/private-catalog-get?token=${encodeURIComponent(token)}`,
      )
      assert(after.status === 404, `revogado HTTP ${after.status}`)
    })

    await test('token expirado e downgrade bloqueiam o catálogo privado', async () => {
      const invalid = await fetch(`${edgeBase}/private-catalog-get?token=${'x'.repeat(43)}`)
      assert(invalid.status === 404, `inválido HTTP ${invalid.status}`)

      const created = await call(
        'customer-price-link-create',
        { customer_id: CUSTOMER_ID },
        { token: userToken },
      )
      const token = created.data.url.split('/').pop()
      await clientQuery(`
        update public.customer_price_tokens
           set created_at = now() - interval '40 days',
               expires_at = now() - interval '10 days'
         where organization_id = '${ORG_ID}' and customer_id = '${CUSTOMER_ID}'
           and revoked_at is null
      `)
      const expired = await fetch(
        `${edgeBase}/private-catalog-get?token=${encodeURIComponent(token)}`,
      )
      assert(expired.status === 404, `expirado HTTP ${expired.status}`)

      const createdAgain = await call(
        'customer-price-link-create',
        { customer_id: CUSTOMER_ID },
        { token: userToken },
      )
      const freshToken = createdAgain.data.url.split('/').pop()
      await clientQuery(`
        update public.subscriptions
           set plan_code = 'essential', plan_version = 1, state = 'active',
               current_period_end = now() + interval '20 days'
         where organization_id = '${ORG_ID}'
      `)
      const downgraded = await fetch(
        `${edgeBase}/private-catalog-get?token=${encodeURIComponent(freshToken)}`,
      )
      assert(downgraded.status === 404, `downgrade HTTP ${downgraded.status}`)

      const blockedOrder = await call('public-order', {
        slug: ORG_SLUG,
        items: [{ product_id: PRODUCT_1, quantity: 1 }],
        company_website: '',
        elapsed_ms: 2000,
        consent: true,
        request_id: crypto.randomUUID(),
        price_token: freshToken,
      }, { headers: { 'x-forwarded-for': '203.0.113.12' } })
      assert(blockedOrder.status === 403, `downgrade order HTTP ${blockedOrder.status}`)
      assert(blockedOrder.data.error === 'plan_required', 'erro de plano')

      await clientQuery(`delete from public.subscriptions where organization_id = '${ORG_ID}'`)
    })


    console.log('[10/10] Orçamentos B2B')

    await test('orçamento HTTP cria, envia, aceita e repete sem duplicar', async () => {
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

      const created = await call(
        'quote-create',
        {
          customer_id: CUSTOMER_ID,
          items: [
            { product_id: PRODUCT_1, quantity: 1 },
            { product_id: PRODUCT_2, quantity: 1 },
          ],
          valid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
          notes: 'Proposta HTTP',
        },
        { token: userToken },
      )
      assert(created.status === 201, `create HTTP ${created.status} ${JSON.stringify(created.data)}`)
      assert(created.data.total_cents === 1899, `total ${created.data.total_cents}`)
      assert(created.data.public_reference.startsWith('OR-'), 'referência')
      const quoteId = created.data.quote_id

      const updated = await call(
        'quote-update',
        {
          quote_id: quoteId,
          expected_version: 1,
          items: [{ product_id: PRODUCT_1, quantity: 2 }],
          valid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
          notes: 'Proposta revisada',
        },
        { token: userToken },
      )
      assert(updated.status === 200, `update HTTP ${updated.status}`)
      assert(updated.data.total_cents === 2000, `update total ${updated.data.total_cents}`)
      assert(updated.data.version === 2, 'versão')

      const sent = await call(
        'quote-send',
        { quote_id: quoteId, expected_version: 2 },
        { token: userToken },
      )
      assert(sent.status === 201, `send HTTP ${sent.status} ${JSON.stringify(sent.data)}`)
      assert(sent.data.url.includes('/o/'), 'url pública')
      const token = sent.data.url.split('/').pop()

      const publicQuote = await fetch(
        `${edgeBase}/quote-get?token=${encodeURIComponent(token)}`,
      )
      const publicData = await publicQuote.json()
      assert(publicQuote.status === 200, `get HTTP ${publicQuote.status}`)
      assert(publicData.status === 'sent', 'status enviado')
      assert(publicData.customer.name === 'Padaria Edge', 'cliente')
      assert(publicData.items.length === 1, 'itens')
      assert(publicData.can_accept === true, 'aceite disponível')
      assert(!JSON.stringify(publicData).includes('11977776666'), 'telefone vazou')
      assert(publicQuote.headers.get('x-robots-tag')?.includes('noindex'), 'noindex')

      const requestId = crypto.randomUUID()
      const accepted = await call(
        'quote-accept',
        {
          token,
          confirm: true,
          request_id: requestId,
          company_website: '',
          elapsed_ms: 2000,
        },
        { headers: { 'x-forwarded-for': '203.0.113.20' } },
      )
      assert(accepted.status === 201, `accept HTTP ${accepted.status} ${JSON.stringify(accepted.data)}`)
      assert(accepted.data.total_cents === 2000, 'total aceito')
      assert(accepted.data.order_reference, 'referência do pedido')

      const replay = await call(
        'quote-accept',
        {
          token,
          confirm: true,
          request_id: requestId,
          company_website: '',
          elapsed_ms: 2000,
        },
        { headers: { 'x-forwarded-for': '203.0.113.20' } },
      )
      assert(replay.status === 200, `replay HTTP ${replay.status}`)
      assert(replay.data.already_accepted === true, 'replay')
      assert(
        replay.data.order_reference === accepted.data.order_reference,
        'pedido diferente',
      )

      const order = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-F', '|', '-c',
        `select source, quote_id, buyer_name from public.orders where quote_id = '${quoteId}'`,
      ]).stdout.trim()
      assert(order.startsWith('quote|'), `origem ${order}`)
      assert(order.endsWith('|'), `PII ${order}`)
      const count = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select count(*) from public.orders where quote_id = '${quoteId}'`,
      ]).stdout.trim()
      assert(count === '1', `pedidos ${count}`)

      const after = await fetch(
        `${edgeBase}/quote-get?token=${encodeURIComponent(token)}`,
      )
      const afterData = await after.json()
      assert(after.status === 200, `get aceito HTTP ${after.status}`)
      assert(afterData.status === 'accepted', 'status aceito')
      assert(afterData.order_reference === accepted.data.order_reference, 'recibo')
    })

    await test('orçamento HTTP recusa, cancela e bloqueia token inválido', async () => {
      const validUntil = new Date(Date.now() + 7 * 86400000).toISOString()
      const created = await call(
        'quote-create',
        {
          customer_id: CUSTOMER_ID,
          items: [{ product_id: PRODUCT_2, quantity: 1 }],
          valid_until: validUntil,
          notes: null,
        },
        { token: userToken },
      )
      assert(created.status === 201, `create HTTP ${created.status}`)
      const quoteId = created.data.quote_id
      const sent = await call(
        'quote-send',
        { quote_id: quoteId, expected_version: 1 },
        { token: userToken },
      )
      const token = sent.data.url.split('/').pop()

      const declined = await call(
        'quote-decline',
        { token, confirm: true },
        { headers: { 'x-forwarded-for': '203.0.113.21' } },
      )
      assert(declined.status === 200, `decline HTTP ${declined.status}`)
      assert(declined.data.status === 'declined', 'status recusado')
      const declinedGet = await fetch(
        `${edgeBase}/quote-get?token=${encodeURIComponent(token)}`,
      )
      const declinedData = await declinedGet.json()
      assert(declinedGet.status === 200, `get recusado HTTP ${declinedGet.status}`)
      assert(declinedData.status === 'declined', 'status público recusado')

      const canceledQuote = await call(
        'quote-create',
        {
          customer_id: CUSTOMER_ID,
          items: [{ product_id: PRODUCT_2, quantity: 1 }],
          valid_until: validUntil,
          notes: null,
        },
        { token: userToken },
      )
      const canceled = await call(
        'quote-cancel',
        { quote_id: canceledQuote.data.quote_id, expected_version: 1 },
        { token: userToken },
      )
      assert(canceled.status === 200, `cancel HTTP ${canceled.status}`)
      assert(canceled.data.status === 'canceled', 'status cancelado')

      const invalid = await fetch(`${edgeBase}/quote-get?token=${'x'.repeat(43)}`)
      assert(invalid.status === 404, `inválido HTTP ${invalid.status}`)
      const invalidAccept = await call(
        'quote-accept',
        {
          token: 'x'.repeat(43),
          confirm: true,
          request_id: crypto.randomUUID(),
          company_website: '',
          elapsed_ms: 2000,
        },
        { headers: { 'x-forwarded-for': '203.0.113.22' } },
      )
      assert(invalidAccept.status === 404, `aceite inválido HTTP ${invalidAccept.status}`)
    })

    await test('preço alterado no orçamento HTTP exige revisão', async () => {
      const created = await call(
        'quote-create',
        {
          customer_id: CUSTOMER_ID,
          items: [{ product_id: PRODUCT_1, quantity: 1 }],
          valid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
          notes: null,
        },
        { token: userToken },
      )
      const sent = await call(
        'quote-send',
        { quote_id: created.data.quote_id, expected_version: 1 },
        { token: userToken },
      )
      const token = sent.data.url.split('/').pop()
      docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-c',
        `update public.price_list_items set price_cents = 1100 where price_list_id = '${PRICE_LIST_ID}' and product_id = '${PRODUCT_1}'`,
      ])
      const stale = await call(
        'quote-accept',
        {
          token,
          confirm: true,
          request_id: crypto.randomUUID(),
          company_website: '',
          elapsed_ms: 2000,
        },
        { headers: { 'x-forwarded-for': '203.0.113.23' } },
      )
      assert(stale.status === 409, `stale HTTP ${stale.status}`)
      assert(stale.data.error === 'quote_stale', `erro ${JSON.stringify(stale.data)}`)
      docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-c',
        `update public.price_list_items set price_cents = 1000 where price_list_id = '${PRICE_LIST_ID}' and product_id = '${PRODUCT_1}'`,
      ])
    })

    await test('orçamento exige Profissional', async () => {
      await clientQuery(`
        update public.subscriptions
           set plan_code = 'essential', plan_version = 1, state = 'active',
               current_period_end = now() + interval '20 days'
         where organization_id = '${ORG_ID}'
      `)
      const denied = await call(
        'quote-create',
        {
          customer_id: CUSTOMER_ID,
          items: [{ product_id: PRODUCT_2, quantity: 1 }],
          valid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
          notes: null,
        },
        { token: userToken },
      )
      assert(denied.status === 403, `plano HTTP ${denied.status}`)
      assert(denied.data.error === 'plan_required', 'erro de plano')
      await clientQuery(`delete from public.subscriptions where organization_id = '${ORG_ID}'`)
    })


    console.log('[11/11] WhatsApp oficial: configuração e outbox desligado')

    await test('opt-in cria outbox bloqueado sem integração pronta', async () => {
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
      const requestId = crypto.randomUUID()
      const response = await call(
        'public-order',
        {
          slug: ORG_SLUG,
          buyer_name: 'Padaria Edge',
          buyer_phone: '11977776666',
          items: [{ product_id: PRODUCT_2, quantity: 1 }],
          company_website: '',
          elapsed_ms: 2000,
          consent: true,
          whatsapp_updates: true,
          request_id: requestId,
        },
        { headers: { 'x-forwarded-for': '203.0.113.30' } },
      )
      assert(response.status === 201, `order HTTP ${response.status}`)
      const order = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-F', '|', '-c',
        `select id, whatsapp_opt_in from public.orders where request_id = '${requestId}'`,
      ]).stdout.trim()
      const [orderId, optIn] = order.split('|')
      assert(optIn === 't', `opt-in ${optIn}`)
      const outbox = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-F', '|', '-c',
        `select status, blocked_reason from public.whatsapp_outbox where order_id = '${orderId}'`,
      ]).stdout.trim()
      assert(outbox === 'blocked|connection_not_ready', `outbox ${outbox}`)
    })

    await test('configuração cifra token e não o devolve', async () => {
      const token = 'EAAG-edge-token-super-secreto-123456'
      const connected = await call(
        'whatsapp-connect',
        { waba_id: 'waba-edge', phone_number_id: 'phone-edge', access_token: token },
        { token: userToken },
      )
      assert(connected.status === 201, `connect HTTP ${connected.status} ${JSON.stringify(connected.data)}`)
      assert(connected.data.status === 'pending_verification', 'status')
      assert(connected.data.send_enabled === false, 'envio não pode estar ativo')
      assert(!JSON.stringify(connected.data).includes(token), 'token retornado')
      const stored = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select token_ciphertext from public.whatsapp_connections where organization_id = '${ORG_ID}'`,
      ]).stdout.trim()
      assert(stored && !stored.includes(token), 'token em texto aberto')

      const config = await fetch(`${edgeBase}/whatsapp-config-get`, {
        headers: { Authorization: `Bearer ${userToken}` },
      })
      const data = await config.json()
      assert(config.status === 200, `config HTTP ${config.status}`)
      assert(data.connection.status === 'pending_verification', 'config status')
      assert(data.send_enabled === false, 'config envio')
      assert(!JSON.stringify(data).includes(token), 'config vazou token')
    })

    await test('worker exige token e permanece desligado', async () => {
      const wrong = await fetch(`${edgeBase}/whatsapp-worker`, {
        method: 'POST',
        headers: { 'x-whatsapp-worker-token': 'errado' },
      })
      assert(wrong.status === 401, `worker errado HTTP ${wrong.status}`)
      const disabled = await fetch(`${edgeBase}/whatsapp-worker`, {
        method: 'POST',
        headers: { 'x-whatsapp-worker-token': WHATSAPP_WORKER_TOKEN },
      })
      const data = await disabled.json()
      assert(disabled.status === 200, `worker HTTP ${disabled.status}`)
      assert(data.disabled === true, 'worker deveria estar desligado')
    })

    await test('webhook valida HMAC e atualiza entrega sem PII', async () => {
      const orderRow = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select id from public.orders where organization_id = '${ORG_ID}' order by created_at desc limit 1`,
      ]).stdout.trim()
      const outboxRow = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `insert into public.whatsapp_outbox
           (organization_id, order_id, event, recipient_phone, status, provider_message_id, idempotency_key)
         values ('${ORG_ID}', '${orderRow}', 'confirmed', '11977776666', 'sent', 'wamid.edge.1', 'webhook:${Date.now()}')
         returning id`,
      ]).stdout.trim().split('\n')[0]
      assert(outboxRow, 'outbox não criada')
      await clientQuery(`
        update public.whatsapp_connections set status = 'connected'
         where organization_id = '${ORG_ID}'
      `)

      const body = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'phone-edge' },
                  statuses: [{ id: 'wamid.edge.1', status: 'delivered' }],
                },
              },
            ],
          },
        ],
      })
      const invalid = await fetch(`${edgeBase}/whatsapp-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=errado' },
        body,
      })
      assert(invalid.status === 401, `assinatura inválida HTTP ${invalid.status}`)

      const signature = `sha256=${createHmac('sha256', WHATSAPP_WEBHOOK_SECRET).update(body).digest('hex')}`
      const response = await fetch(`${edgeBase}/whatsapp-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
        body,
      })
      const data = await response.json()
      assert(response.status === 200, `webhook HTTP ${response.status}`)
      assert(data.processed === 1, `processados ${data.processed}`)
      const state = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-F', '|', '-c',
        `select provider_status, status from public.whatsapp_outbox where id = '${outboxRow}'`,
      ]).stdout.trim()
      assert(state === 'delivered|sent', `estado ${state}`)
      const events = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select count(*) from public.whatsapp_events where outbox_id = '${outboxRow}'`,
      ]).stdout.trim()
      assert(events === '1', `eventos ${events}`)
    })

    await test('desconectar limpa token e desliga envio', async () => {
      const response = await call('whatsapp-disconnect', {}, { token: userToken })
      assert(response.status === 200, `disconnect HTTP ${response.status}`)
      const row = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-F', '|', '-c',
        `select status, token_ciphertext from public.whatsapp_connections where organization_id = '${ORG_ID}'`,
      ]).stdout.trim()
      assert(row === 'disabled|', `conexão ${row}`)
      await clientQuery(`delete from public.subscriptions where organization_id = '${ORG_ID}'`)
    })


    console.log('[12/12] Equipe e convites manuais')

    await test('equipe exige AAL2, aceita convite e revoga acesso', async () => {
      await clientQuery(`
        insert into public.subscriptions
          (organization_id, state, current_period_end, plan_code, plan_version)
        values ('${ORG_ID}', 'active', now() + interval '20 days', 'professional', 1)
        on conflict (organization_id) do update
          set state = 'active', current_period_end = now() + interval '20 days',
              plan_code = 'professional', plan_version = 1
      `)

      const withoutMfa = await fetch(`${edgeBase}/team-list`, {
        headers: { Authorization: `Bearer ${userToken}` },
      })
      assert(withoutMfa.status === 403, `sem AAL2 HTTP ${withoutMfa.status}`)

      const invited = await call(
        'team-invite',
        { email: 'edge-invitee@example.test', role: 'operator' },
        { token: supplierAal2Token },
      )
      assert(invited.status === 201, `invite HTTP ${invited.status} ${JSON.stringify(invited.data)}`)
      assert(invited.data.email_sent === false, 'não pode alegar envio')
      assert(invited.data.url.includes('/convite/'), 'url do convite')
      const inviteToken = invited.data.url.split('/').pop()

      const accepted = await call(
        'team-accept',
        { token: inviteToken },
        { token: inviteeToken },
      )
      assert(accepted.status === 200, `accept HTTP ${accepted.status} ${JSON.stringify(accepted.data)}`)
      assert(accepted.data.role === 'operator', 'papel aceito')

      const list = await fetch(`${edgeBase}/team-list`, {
        headers: { Authorization: `Bearer ${supplierAal2Token}` },
      })
      const data = await list.json()
      assert(list.status === 200, `list HTTP ${list.status}`)
      const member = data.members.find((item) => item.email === 'edge-invitee@example.test')
      assert(member, 'membro não listado')

      const role = await call(
        'team-role',
        { membership_id: member.id, role: 'viewer' },
        { token: supplierAal2Token },
      )
      assert(role.status === 200, `role HTTP ${role.status}`)

      const revoked = await call(
        'team-revoke',
        { membership_id: member.id },
        { token: supplierAal2Token },
      )
      assert(revoked.status === 200, `revoke HTTP ${revoked.status}`)
      assert(revoked.data.status === 'revoked', 'status revogado')

      const replay = await call(
        'team-accept',
        { token: inviteToken },
        { token: inviteeToken },
      )
      assert(replay.status === 404, `replay HTTP ${replay.status}`)
    })

    await test('limite de três usuários e AAL2 protegem convites', async () => {
      const noMfa = await call(
        'team-invite',
        { email: 'blocked@example.test', role: 'viewer' },
        { token: userToken },
      )
      assert(noMfa.status === 403, `convite sem AAL2 HTTP ${noMfa.status}`)

      for (const email of ['pending-a@example.test', 'pending-b@example.test']) {
        const response = await call( // NOSONAR: dois convites sequenciais para testar o limite.
          'team-invite',
          { email, role: 'viewer' },
          { token: supplierAal2Token },
        )
        assert(response.status === 201, `convite ${email} HTTP ${response.status}`)
      }
      const overLimit = await call(
        'team-invite',
        { email: 'pending-c@example.test', role: 'viewer' },
        { token: supplierAal2Token },
      )
      assert(overLimit.status === 409, `limite HTTP ${overLimit.status}`)
      assert(overLimit.data.error === 'team_limit_reached', 'erro de limite')
      await clientQuery(`delete from public.subscriptions where organization_id = '${ORG_ID}'`)
    })


    console.log('[13/13] Lembretes manuais de reposição')

    await test('lembrete manual é idempotente, marca abertura e respeita opt-out', async () => {
      await clientQuery(`
        insert into public.subscriptions
          (organization_id, state, current_period_end, plan_code, plan_version)
        values ('${ORG_ID}', 'active', now() + interval '20 days', 'professional', 1)
        on conflict (organization_id) do update
          set state = 'active', current_period_end = now() + interval '20 days',
              plan_code = 'professional', plan_version = 1
      `)
      await clientQuery(`
        update public.organizations
           set reorder_reminder_enabled = true, reorder_reminder_channel = 'manual'
         where id = '${ORG_ID}'
      `)
      await clientQuery(`
        update public.customers
           set reorder_opt_in = true, reorder_opt_out_at = null
         where id = '${CUSTOMER_ID}'
      `)

      const cycleKey = `manual-test-${Date.now()}`
      const created = await call(
        'reorder-reminder-create',
        {
          customer_id: CUSTOMER_ID,
          cycle_key: cycleKey,
          message: 'Olá! Já faz alguns dias desde o último pedido. Quer repetir?',
        },
        { token: userToken },
      )
      assert(created.status === 201, `create HTTP ${created.status} ${JSON.stringify(created.data)}`)
      assert(created.data.status === 'suggested', 'status sugerido')

      const repeated = await call(
        'reorder-reminder-create',
        {
          customer_id: CUSTOMER_ID,
          cycle_key: cycleKey,
          message: 'Olá! Já faz alguns dias desde o último pedido. Quer repetir?',
        },
        { token: userToken },
      )
      assert(repeated.status === 201, `retry HTTP ${repeated.status}`)
      assert(repeated.data.reminder_id === created.data.reminder_id, 'lembrete duplicado')
      const count = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select count(*) from public.reorder_reminders where cycle_key = '${cycleKey}'`,
      ]).stdout.trim()
      assert(count === '1', `lembretes ${count}`)

      const opened = await call(
        'reorder-reminder-open',
        { reminder_id: created.data.reminder_id },
        { token: userToken },
      )
      assert(opened.status === 200, `open HTTP ${opened.status}`)
      assert(opened.data.status === 'manual_opened', 'status de abertura')
      const sent = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select sent_at from public.reorder_reminders where id = '${created.data.reminder_id}'`,
      ]).stdout.trim()
      assert(sent === '', 'abertura manual não pode alegar envio')

      await clientQuery(`
        update public.customers set reorder_opt_out_at = now()
         where id = '${CUSTOMER_ID}'
      `)
      const blocked = await call(
        'reorder-reminder-create',
        {
          customer_id: CUSTOMER_ID,
          cycle_key: `${cycleKey}-2`,
          message: 'Mensagem que não deve ser criada',
        },
        { token: userToken },
      )
      assert(blocked.status === 409, `opt-out HTTP ${blocked.status}`)
      assert(blocked.data.error === 'reminder_not_consented', 'erro de consentimento')

      const isolated = docker([
        'exec', PG_CONTAINER,
        'psql', '-U', 'postgres', '-d', DB_NAME, '-t', '-A', '-c',
        `select count(*) from public.reorder_reminders where organization_id = '${ORG_ID}'`,
      ]).stdout.trim()
      assert(isolated === '1', `histórico ${isolated}`)
      await clientQuery(`delete from public.subscriptions where organization_id = '${ORG_ID}'`)
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
