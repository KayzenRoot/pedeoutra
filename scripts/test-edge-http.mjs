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
const ORG_ID = 'eeeeeeee-2222-4222-8222-222222222222'
const ORG_SLUG = 'distribuidora-edge-abc123'
const PRODUCT_1 = 'eeeeeeee-3333-4333-8333-333333333333'
const PRODUCT_2 = 'eeeeeeee-4444-4444-8444-444444444444'
const PRODUCT_INACTIVE = 'eeeeeeee-5555-4555-8555-555555555555'
const CUSTOMER_ID = 'eeeeeeee-6666-4666-8666-666666666666'
const LINK_ID = 'eeeeeeee-7777-4777-8777-777777777777'
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

async function waitForSql() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
insert into auth.users (id, email) values ('${USER_ID}', 'edge@example.test');

insert into public.organizations (id, owner_user_id, name, slug, whatsapp, city)
values (
  '${ORG_ID}', '${USER_ID}', 'Distribuidora Edge', '${ORG_SLUG}',
  '11999998888', 'São Paulo'
);

insert into public.products (id, organization_id, name, unit, price_cents, active)
values
  ('${PRODUCT_1}', '${ORG_ID}', 'Copo 200ml', 'cento', 1250, true),
  ('${PRODUCT_2}', '${ORG_ID}', 'Água 5L', 'galão', 899, true),
  ('${PRODUCT_INACTIVE}', '${ORG_ID}', 'Item pausado', 'un', 500, false);

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
    proxy = createHttpServer((request, response) => {
      const url = request.url ?? '/'
      if (url.startsWith('/auth/v1/user')) {
        const authorization = request.headers.authorization ?? ''
        if (authorization !== `Bearer ${userToken}`) {
          response.writeHead(401, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ message: 'invalid jwt' }))
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            id: USER_ID,
            email: 'edge@example.test',
            role: 'authenticated',
            aud: 'authenticated',
          }),
        )
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
