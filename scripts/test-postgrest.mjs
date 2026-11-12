#!/usr/bin/env node
/**
 * Integração HTTP real com PostgREST + Postgres:
 * - create_organization via RPC;
 * - CRUD de produto com RLS;
 * - api_submit_order com service_role;
 * - leitura de pedidos e view segura;
 * - transição de status e rejeição de transição inválida.
 *
 * Não depende de Supabase Cloud, Auth Cloud ou Edge Runtime.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const BOOTSTRAP = join(ROOT, 'supabase', 'tests', '00_bootstrap.sql')
const NETWORK = `pedeoutra-pgrst-${process.pid}`
const PG_CONTAINER = `pedeoutra-pgrst-db-${process.pid}`
const REST_CONTAINER = `pedeoutra-pgrst-rest-${process.pid}`
const IMAGE_PG = 'postgres:17-alpine'
const IMAGE_REST = 'public.ecr.aws/supabase/postgrest:v16.4'
const DB_NAME = 'pedeoutra_pgrst'
const JWT_SECRET = 'pedeoutra-test-secret-with-at-least-32-characters'
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'

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

async function waitForRest(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`)
      if (response.status < 500) return
    } catch {
      // subindo
    }
    await sleep(250)
  }
  throw new Error('PostgREST não ficou pronto')
}

async function main() {
  const restPort = await findFreePort()
  const baseUrl = `http://127.0.0.1:${restPort}`
  console.log(`PedeOutra PostgREST test — ${baseUrl}`)

  docker(['network', 'create', NETWORK], { allowFailure: true })
  docker([
    'run', '--rm', '-d',
    '--name', PG_CONTAINER,
    '--network', NETWORK,
    '--network-alias', 'db',
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', `POSTGRES_DB=${DB_NAME}`,
    IMAGE_PG,
  ])

  try {
    await waitForSql()
    console.log('[1/4] Bootstrap e migrations')
    applyFile(BOOTSTRAP)
    for (const file of readdirSync(MIGRATIONS_DIR).filter((item) => item.endsWith('.sql')).sort()) {
      applyFile(join(MIGRATIONS_DIR, file))
      console.log(`  applied ${file}`)
    }

    const seed = spawnSync(
      'docker',
      ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1'],
      {
        input: `insert into auth.users (id, email) values ('${USER_A}', 'a@example.test'), ('${USER_B}', 'b@example.test');`,
        encoding: 'utf8',
      },
    )
    if (seed.status !== 0) throw new Error(`seed auth: ${seed.stderr}`)
    ok('auth.users sintéticos')

    console.log('[2/4] PostgREST')
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
      IMAGE_REST,
    ])
    await waitForRest(baseUrl)
    ok('PostgREST respondendo')

    const tokenA = signJwt({ role: 'authenticated', sub: USER_A })
    const tokenB = signJwt({ role: 'authenticated', sub: USER_B })
    const tokenService = signJwt({ role: 'service_role', sub: USER_A })
    const tokenAnon = signJwt({ role: 'anon' })

    async function request(path, { method = 'GET', token = tokenA, body, headers = {} } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
      return { status: response.status, data, text }
    }

    console.log('[3/4] RPC e RLS via HTTP')
    let orgA
    let orgB
    let productA
    let orderId

    await test('create_organization via RPC (A e B)', async () => {
      const a = await request('/rpc/create_organization', {
        method: 'POST',
        body: { p_name: 'Distribuidora HTTP A', p_whatsapp: '11999998888', p_city: 'São Paulo' },
      })
      assert(a.status === 200, `A: HTTP ${a.status} ${a.text}`)
      orgA = Array.isArray(a.data) ? a.data[0] : a.data
      assert(orgA.slug.startsWith('distribuidora-http-a-'), 'slug A')

      const b = await request('/rpc/create_organization', {
        method: 'POST',
        token: tokenB,
        body: { p_name: 'Distribuidora HTTP B', p_whatsapp: '21988887777' },
      })
      assert(b.status === 200, `B: HTTP ${b.status} ${b.text}`)
      orgB = Array.isArray(b.data) ? b.data[0] : b.data
      assert(orgB.id !== orgA.id, 'orgs distintas')
    })

    await test('insert de produto com RLS', async () => {
      const a = await request('/products', {
        method: 'POST',
        body: {
          organization_id: orgA.id,
          name: 'Copo HTTP',
          unit: 'cento',
          price_cents: 1250,
        },
        headers: { Prefer: 'return=representation' },
      })
      assert(a.status === 201, `insert A: HTTP ${a.status} ${a.text}`)
      productA = a.data[0]

      const b = await request('/products', {
        method: 'POST',
        token: tokenB,
        body: {
          organization_id: orgB.id,
          name: 'Gelo HTTP',
          unit: 'saco',
          price_cents: 1500,
        },
        headers: { Prefer: 'return=representation' },
      })
      assert(b.status === 201, `insert B: HTTP ${b.status} ${b.text}`)
    })

    await test('A lê apenas o próprio produto', async () => {
      const result = await request('/products?select=id,name,organization_id')
      assert(result.status === 200, `HTTP ${result.status}`)
      assert(result.data.length === 1, `esperava 1 produto, veio ${result.data.length}`)
      assert(result.data[0].id === productA.id, 'produto de A')
    })

    await test('A não insere produto forjando org B', async () => {
      const result = await request('/products', {
        method: 'POST',
        body: { organization_id: orgB.id, name: 'Forjado', unit: 'un' },
      })
      assert(result.status >= 400, `deveria falhar, veio HTTP ${result.status}`)
      assert(/row-level security|permission denied/i.test(result.text), result.text)
    })

    await test('A não lê billing_events', async () => {
      const result = await request('/billing_events?select=id')
      assert(result.status >= 400, `deveria falhar, veio HTTP ${result.status}`)
    })

    await test('anon não lê products', async () => {
      const result = await request('/products?select=id', { token: tokenAnon })
      assert(result.status >= 400, `deveria falhar, veio HTTP ${result.status}`)
    })

    await test('view segura de links não expõe token_hash', async () => {
      const result = await request('/reorder_links_safe?select=*')
      assert(result.status === 200, `HTTP ${result.status} ${result.text}`)
      assert(Array.isArray(result.data), 'deveria ser array')
      assert(!result.text.includes('token_hash'), 'token_hash exposto')
    })

    console.log('[4/4] Pedido via RPC e status')
    await test('api_submit_order via service_role calcula total', async () => {
      const result = await request('/rpc/api_submit_order', {
        method: 'POST',
        token: tokenService,
        body: {
          p_org_slug: orgA.slug,
          p_buyer_name: 'Padaria HTTP',
          p_buyer_phone: '11977776666',
          p_note: 'Teste PostgREST',
          p_items: [{ product_id: productA.id, quantity: 2 }],
          p_rate_bucket: `http:${'a'.repeat(64)}`,
          p_request_id: crypto.randomUUID(),
        },
      })
      assert(result.status === 200, `HTTP ${result.status} ${result.text}`)
      const order = Array.isArray(result.data) ? result.data[0] : result.data
      assert(order.total_cents === 2500, `total ${order.total_cents}`)
      orderId = order.order_id
    })

    await test('A lê o pedido com RLS', async () => {
      const result = await request('/orders?select=id,public_reference,total_cents,status')
      assert(result.status === 200, `HTTP ${result.status} ${result.text}`)
      assert(result.data.length === 1, 'esperava 1 pedido')
      assert(result.data[0].id === orderId, 'pedido correto')
    })

    await test('A confirma o pedido e transição inválida falha', async () => {
      const valid = await request(`/orders?id=eq.${orderId}`, {
        method: 'PATCH',
        body: { status: 'confirmed' },
        headers: { Prefer: 'return=representation' },
      })
      assert(valid.status === 200, `PATCH válido: HTTP ${valid.status} ${valid.text}`)
      assert(valid.data[0].status === 'confirmed', 'status confirmado')

      const invalid = await request(`/orders?id=eq.${orderId}`, {
        method: 'PATCH',
        body: { status: 'new' },
      })
      assert(invalid.status >= 400, `transição inválida deveria falhar, veio ${invalid.status}`)
      assert(/invalid_status_transition/i.test(invalid.text), invalid.text)
    })

    await test('api_org_can_write via service_role', async () => {
      const result = await request('/rpc/api_org_can_write', {
        method: 'POST',
        token: tokenService,
        body: { p_organization_id: orgA.id },
      })
      assert(result.status === 200, `HTTP ${result.status} ${result.text}`)
      assert(result.data === true, `esperava true, veio ${JSON.stringify(result.data)}`)
    })

    console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`)
    if (failed > 0) {
      for (const { name, error } of failures) console.error(`  - ${name}: ${error.message}`)
      process.exitCode = 1
    }
  } finally {
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
