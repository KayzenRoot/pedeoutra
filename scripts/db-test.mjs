#!/usr/bin/env node
/**
 * Teste de integração do banco PedeOutra em Postgres real (Docker).
 *
 * Cobre: migrations, RLS A/B, trial/assinatura, pedido público com total
 * server-side, rate limit, recompra, idempotência, status e billing events.
 * Nenhum dado real ou credencial é usado.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { Client } from 'pg'

const ROOT = resolve(import.meta.dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const CONTAINER = `pedeoutra-db-test-${process.pid}`
const DB_NAME = 'pedeoutra_test'
const DB_PASSWORD = 'postgres'
const IMAGE = 'postgres:17-alpine'

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const USER_C = '33333333-3333-4333-8333-333333333333'
const USER_D = '44444444-4444-4444-8444-444444444444'
const USER_F = '66666666-6666-4666-8666-666666666666'
const USER_G = '77777777-7777-4777-8777-777777777777'
const USER_H = '88888888-8888-4888-8888-888888888888'
const USER_I = '99999999-9999-4999-8999-999999999999'
const USER_J = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_K = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TOKEN_HASH = 'a'.repeat(64)

let passed = 0
let failed = 0
const failures = []

function ok(name) {
  passed += 1
  console.log(`  PASS  ${name}`)
}

function fail(name, error) {
  failed += 1
  failures.push({ name, error })
  console.log(`  FAIL  ${name}: ${error.message}`)
}

async function test(name, fn) {
  try {
    await fn()
    ok(name)
  } catch (error) {
    fail(name, error)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectError(fn, fragment, message) {
  try {
    await fn()
  } catch (error) {
    if (!String(error.message).toLowerCase().includes(fragment.toLowerCase())) {
      throw new Error(`${message}: esperava "${fragment}", recebeu "${error.message}"`)
    }
    return
  }
  throw new Error(`${message}: esperava erro contendo "${fragment}", mas a operação passou`)
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    ...options,
  })
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

const BOOTSTRAP_SQL = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz
);
alter table auth.users add column if not exists email_confirmed_at timestamptz;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`

async function connect(port) {
  const client = new Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl: false,
  })
  await client.connect()
  return client
}

async function main() {
  const port = await findFreePort()
  console.log(`PedeOutra DB test — container ${CONTAINER} na porta ${port}`)

  docker([
    'run', '--rm', '-d',
    '--name', CONTAINER,
    '-e', `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    '-e', `POSTGRES_DB=${DB_NAME}`,
    '-p', `127.0.0.1:${port}:5432`,
    IMAGE,
  ])

  let client
  try {
    for (let attempt = 1; attempt <= 180; attempt += 1) {
      try {
        client = await connect(port)
        break
      } catch {
        await sleep(500)
      }
    }
    if (!client) {
      const logs = docker(['logs', CONTAINER], { allowFailure: true })
      throw new Error(
        `Postgres não ficou pronto em 90s\n${logs.stdout || ''}\n${logs.stderr || ''}`,
      )
    }

    console.log('\n[1/8] Bootstrap e migrations')
    await client.query(BOOTSTRAP_SQL)
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort()
    for (const file of migrations) {
      await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      console.log(`  applied ${file}`)
    }
    ok(`${migrations.length} migrations aplicadas`)

    async function asRole(role, fn) {
      await client.query(`set role ${role}`)
      try {
        return await fn()
      } finally {
        await client.query('reset role')
      }
    }

    async function asUser(userId, fn) {
      await client.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId])
      try {
        return await asRole('authenticated', fn)
      } finally {
        await client.query(`select set_config('request.jwt.claim.sub', '', false)`)
      }
    }

    async function asService(fn) {
      return asRole('service_role', fn)
    }

    async function createOrg(userId, name, whatsapp) {
      return asUser(userId, async () => {
        const result = await client.query(
          'select * from public.create_organization($1, $2, $3)',
          [name, whatsapp, 'São Paulo'],
        )
        return result.rows[0]
      })
    }

    async function insertProduct(orgId, name, price) {
      const result = await client.query(
        `insert into public.products (organization_id, name, unit, price_cents)
         values ($1, $2, 'cento', $3) returning *`,
        [orgId, name, price],
      )
      return result.rows[0]
    }

    async function insertCustomer(orgId, name, phone) {
      const result = await client.query(
        `insert into public.customers (organization_id, display_name, contact_phone)
         values ($1, $2, $3) returning *`,
        [orgId, name, phone],
      )
      return result.rows[0]
    }

    console.log('\n[2/8] Seed sintético e criação de organizações')
    await client.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
      USER_A, 'a@example.test', USER_B, 'b@example.test',
    ])

    const orgA = await createOrg(USER_A, 'Distribuidora Aurora', '11999998888')
    const orgB = await createOrg(USER_B, 'Distribuidora Boreal', '21988887777')
    assert(orgA.slug.startsWith('distribuidora-aurora-'), 'slug A inesperado')
    assert(orgB.id !== orgA.id, 'organizações devem ser distintas')

    const productA1 = await asUser(USER_A, () => insertProduct(orgA.id, 'Copo 200ml', 1250))
    const productA2 = await asUser(USER_A, () => insertProduct(orgA.id, 'Água 5L', 899))
    const productB = await asUser(USER_B, () => insertProduct(orgB.id, 'Gelo 5kg', 1500))
    const customerA = await asUser(USER_A, () => insertCustomer(orgA.id, 'Padaria Pão Bom', '11977776666'))
    const customerB = await asUser(USER_B, () => insertCustomer(orgB.id, 'Mercado Boreal', '21966665555'))

    console.log('\n[3/8] RLS A/B')
    await test('A lê apenas a própria organização', async () => {
      const rows = await asUser(USER_A, async () => (await client.query('select id from public.organizations')).rows)
      assert(rows.length === 1 && rows[0].id === orgA.id, 'A deveria ver só org A')
    })

    await test('A lê apenas os próprios produtos', async () => {
      const rows = await asUser(USER_A, async () => (await client.query('select id from public.products')).rows)
      const ids = rows.map((row) => row.id)
      assert(ids.includes(productA1.id) && ids.includes(productA2.id), 'produtos A ausentes')
      assert(!ids.includes(productB.id), 'produto B vazou para A')
    })

    await test('A não lê clientes de B', async () => {
      const rows = await asUser(USER_A, async () => (await client.query('select id from public.customers')).rows)
      const ids = rows.map((row) => row.id)
      assert(ids.includes(customerA.id), 'cliente A ausente')
      assert(!ids.includes(customerB.id), 'cliente B vazou para A')
    })

    await test('A não insere produto forjando org B', async () => {
      await expectError(
        () => asUser(USER_A, () => client.query(
          `insert into public.products (organization_id, name, unit) values ($1, 'Forjado', 'un')`,
          [orgB.id],
        )),
        'row-level security',
        'insert cross-tenant',
      )
    })

    await test('A não atualiza produto de B', async () => {
      const result = await asUser(USER_A, () => client.query(
        `update public.products set name = 'Hack' where id = $1`,
        [productB.id],
      ))
      assert(result.rowCount === 0, 'A conseguiu atualizar produto B')
    })

    await test('A não altera trial ou owner da organização', async () => {
      await expectError(
        () => asUser(USER_A, () => client.query(
          `update public.organizations set trial_ends_at = now() + interval '99 days' where id = $1`,
          [orgA.id],
        )),
        'permission denied',
        'update de coluna privilegiada',
      )
    })

    await test('A não lê token_hash direto (apenas view segura)', async () => {
      await expectError(
        () => asUser(USER_A, () => client.query('select token_hash from public.reorder_links')),
        'permission denied',
        'select token_hash',
      )
    })

    await test('anon não lê tabelas de negócio', async () => {
      await expectError(
        () => asRole('anon', () => client.query('select id from public.products')),
        'permission denied',
        'select anon',
      )
    })

    await test('A não lê billing_events', async () => {
      await expectError(
        () => asUser(USER_A, () => client.query('select id from public.billing_events')),
        'permission denied',
        'select billing_events',
      )
    })

    console.log('\n[4/8] Trial, assinatura e escrita')
    await test('trial expirado bloqueia escrita', async () => {
      await client.query(`update public.organizations set trial_ends_at = now() - interval '1 day' where id = $1`, [orgA.id])
      await expectError(
        () => asUser(USER_A, () => insertProduct(orgA.id, 'Bloqueado', 100)),
        'row-level security',
        'insert com trial expirado',
      )
    })

    await test('assinatura ativa libera escrita', async () => {
      await client.query(
        `insert into public.subscriptions (organization_id, state, current_period_end)
         values ($1, 'active', now() + interval '30 days')`,
        [orgA.id],
      )
      const product = await asUser(USER_A, () => insertProduct(orgA.id, 'Liberado', 500))
      assert(product.id, 'produto não criado')
    })

    await test('reembolso revoga escrita', async () => {
      await client.query(`update public.subscriptions set state = 'refunded' where organization_id = $1`, [orgA.id])
      await expectError(
        () => asUser(USER_A, () => insertProduct(orgA.id, 'Reembolsado', 100)),
        'row-level security',
        'insert após reembolso',
      )
    })

    await test('reembolso não estende trial vigente', async () => {
      await client.query(
        `update public.organizations set trial_ends_at = now() + interval '1 day' where id = $1`,
        [orgA.id],
      )
      const product = await asUser(USER_A, () => insertProduct(orgA.id, 'Trial vigente', 100))
      assert(product.id, 'trial vigente deveria permitir escrita')

      await client.query(
        `update public.organizations set trial_ends_at = now() - interval '1 day' where id = $1`,
        [orgA.id],
      )
      await expectError(
        () => asUser(USER_A, () => insertProduct(orgA.id, 'Trial expirado', 100)),
        'row-level security',
        'insert após trial expirado com reembolso',
      )
    })

    await test('cancelado mantém acesso até o fim do período', async () => {
      await client.query(
        `update public.subscriptions
            set state = 'canceled', current_period_end = now() + interval '5 days'
          where organization_id = $1`,
        [orgA.id],
      )
      const product = await asUser(USER_A, () => insertProduct(orgA.id, 'Cancelado com acesso', 100))
      assert(product.id, 'acesso deveria continuar até o período')
    })

    await test('past_due tem carência de 3 dias e depois bloqueia', async () => {
      await client.query(
        `update public.subscriptions
            set state = 'past_due', current_period_end = now() - interval '1 day'
          where organization_id = $1`,
        [orgA.id],
      )
      const within = await asUser(USER_A, () => insertProduct(orgA.id, 'Carência', 100))
      assert(within.id, 'carência deveria permitir')

      await client.query(
        `update public.subscriptions
            set current_period_end = now() - interval '5 days'
          where organization_id = $1`,
        [orgA.id],
      )
      await expectError(
        () => asUser(USER_A, () => insertProduct(orgA.id, 'Fora da carência', 100)),
        'row-level security',
        'insert após carência',
      )
    })

    // Restaura acesso de A para os testes de pedido.
    await client.query(
      `update public.subscriptions
          set state = 'active', current_period_end = now() + interval '30 days'
        where organization_id = $1`,
      [orgA.id],
    )

    console.log('\n[5/8] Pedido público, recompra, rate limit e idempotência')
    const requestId = '33333333-3333-4333-8333-333333333333'
    let publicOrder

    await test('pedido público calcula total no servidor e ignora preço do cliente', async () => {
      const result = await asService(() => client.query(
        `select * from app.submit_order(
          $1, 'Padaria Pão Bom', '11977776666', 'Entregar pela manhã',
          $2::jsonb, $3, null, 'catalog', $4
        )`,
        [
          orgA.slug,
          JSON.stringify([
            { product_id: productA1.id, quantity: 2, price_cents: 1 },
            { product_id: productA2.id, quantity: 3, price_cents: 1 },
          ]),
          `ip:${'b'.repeat(64)}`,
          requestId,
        ],
      ))
      publicOrder = result.rows[0]
      const expected = 1250 * 2 + 899 * 3
      assert(publicOrder.total_cents === expected, `total ${publicOrder.total_cents} != ${expected}`)
      assert(publicOrder.item_count === 2, 'item_count')
      assert(/^PD-[0-9A-F]{10}$/.test(publicOrder.public_reference), 'referência pública')
    })

    await test('mesmo request_id não duplica pedido', async () => {
      const result = await asService(() => client.query(
        `select * from app.submit_order(
          $1, 'Padaria Pão Bom', '11977776666', 'Entregar pela manhã',
          $2::jsonb, $3, null, 'catalog', $4
        )`,
        [
          orgA.slug,
          JSON.stringify([{ product_id: productA1.id, quantity: 2 }]),
          `ip:${'b'.repeat(64)}`,
          requestId,
        ],
      ))
      assert(result.rows[0].order_id === publicOrder.order_id, 'pedido duplicado')
      const count = await client.query('select count(*)::int as total from public.orders where request_id = $1', [requestId])
      assert(count.rows[0].total === 1, 'deveria existir um pedido')
    })

    await test('produto inativo é rejeitado', async () => {
      await asUser(USER_A, () => client.query('update public.products set active = false where id = $1', [productA2.id]))
      await expectError(
        () => asService(() => client.query(
          `select * from app.submit_order($1, 'Cliente Teste', '11977776666', null, $2::jsonb, $3, null, 'catalog', null)`,
          [orgA.slug, JSON.stringify([{ product_id: productA2.id, quantity: 1 }]), `ip:${'c'.repeat(64)}`],
        )),
        'invalid_product',
        'produto inativo',
      )
      await asUser(USER_A, () => client.query('update public.products set active = true where id = $1', [productA2.id]))
    })

    await test('produto de outro tenant é rejeitado', async () => {
      await expectError(
        () => asService(() => client.query(
          `select * from app.submit_order($1, 'Cliente Teste', '11977776666', null, $2::jsonb, $3, null, 'catalog', null)`,
          [orgA.slug, JSON.stringify([{ product_id: productB.id, quantity: 1 }]), `ip:${'d'.repeat(64)}`],
        )),
        'invalid_product',
        'produto cross-tenant',
      )
    })

    await test('quantidade e duplicidade inválidas são rejeitadas', async () => {
      await expectError(
        () => asService(() => client.query(
          `select * from app.submit_order($1, 'Cliente Teste', '11977776666', null, $2::jsonb, $3, null, 'catalog', null)`,
          [orgA.slug, JSON.stringify([{ product_id: productA1.id, quantity: 1000 }]), `ip:${'e'.repeat(64)}`],
        )),
        'invalid_items',
        'quantidade 1000',
      )
      await expectError(
        () => asService(() => client.query(
          `select * from app.submit_order($1, 'Cliente Teste', '11977776666', null, $2::jsonb, $3, null, 'catalog', null)`,
          [orgA.slug, JSON.stringify([
            { product_id: productA1.id, quantity: 1 },
            { product_id: productA1.id, quantity: 2 },
          ]), `ip:${'f'.repeat(64)}`],
        )),
        'duplicate_items',
        'item duplicado',
      )
    })

    await test('rate limit atômico bloqueia após o limite', async () => {
      const bucket = `unit:${'9'.repeat(64)}`
      const results = []
      for (let i = 0; i < 4; i += 1) {
        const result = await asService(() => client.query(
          'select app.consume_rate_limit($1, 3, 600) as allowed',
          [bucket],
        ))
        results.push(result.rows[0].allowed)
      }
      assert(JSON.stringify(results) === JSON.stringify([true, true, true, false]), `resultado ${results}`)
    })

    await test('recompra válida cria pedido vinculado ao cliente sem PII', async () => {
      const link = await asService(() => client.query(
        `insert into public.reorder_links
           (organization_id, customer_id, token_hash, template_json, expires_at, created_by)
         values ($1, $2, $3, $4::jsonb, now() + interval '60 days', $5)
         returning *`,
        [orgA.id, customerA.id, TOKEN_HASH, JSON.stringify([{ product_id: productA1.id, quantity: 4 }]), USER_A],
      ))
      const result = await asService(() => client.query(
        `select * from app.submit_order($1, null, null, null, $2::jsonb, $3, $4, 'reorder', null)`,
        [
          orgA.slug,
          JSON.stringify([{ product_id: productA1.id, quantity: 4 }]),
          `ip:${'1'.repeat(64)}`,
          link.rows[0].id,
        ],
      ))
      const order = result.rows[0]
      assert(order.total_cents === 1250 * 4, 'total de recompra')

      const detail = await client.query(
        'select customer_id, buyer_name, buyer_phone from public.orders where id = $1',
        [order.order_id],
      )
      assert(detail.rows[0].customer_id === customerA.id, 'customer_id não vinculado')
      assert(detail.rows[0].buyer_name === null && detail.rows[0].buyer_phone === null, 'PII indevida no pedido')

      const viewRows = await asUser(USER_A, async () => (await client.query(
        'select * from public.reorder_links_safe where id = $1',
        [link.rows[0].id],
      )).rows)
      assert(viewRows.length === 1 && !('token_hash' in viewRows[0]), 'view expôs token_hash')
    })

    await test('link revogado é rejeitado', async () => {
      const link = await asService(() => client.query(
        `insert into public.reorder_links
           (organization_id, customer_id, token_hash, template_json, expires_at)
         values ($1, $2, $3, '[]'::jsonb, now() + interval '1 day')
         returning *`,
        [orgA.id, customerA.id, 'b'.repeat(64)],
      ))
      await asService(() => client.query('update public.reorder_links set revoked_at = now() where id = $1', [link.rows[0].id]))
      await expectError(
        () => asService(() => client.query(
          `select * from app.submit_order($1, null, null, null, $2::jsonb, $3, $4, 'reorder', null)`,
          [orgA.slug, JSON.stringify([{ product_id: productA1.id, quantity: 1 }]), `ip:${'2'.repeat(64)}`, link.rows[0].id],
        )),
        'invalid_reorder_link',
        'link revogado',
      )
    })

    await test('link expirado é rejeitado', async () => {
      const link = await asService(() => client.query(
        `insert into public.reorder_links
           (organization_id, customer_id, token_hash, template_json, expires_at, created_at)
         values ($1, $2, $3, '[]'::jsonb, now() - interval '1 minute', now() - interval '2 days')
         returning *`,
        [orgA.id, customerA.id, 'c'.repeat(64)],
      ))
      await expectError(
        () => asService(() => client.query(
          `select * from app.submit_order($1, null, null, null, $2::jsonb, $3, $4, 'reorder', null)`,
          [orgA.slug, JSON.stringify([{ product_id: productA1.id, quantity: 1 }]), `ip:${'3'.repeat(64)}`, link.rows[0].id],
        )),
        'invalid_reorder_link',
        'link expirado',
      )
    })

    console.log('\n[6/8] Status do pedido e billing')
    await test('transição válida grava evento com autor', async () => {
      await asUser(USER_A, () => client.query(
        `update public.orders set status = 'confirmed' where id = $1`,
        [publicOrder.order_id],
      ))
      const events = await asUser(USER_A, async () => (await client.query(
        'select * from public.order_status_events where order_id = $1 order by created_at',
        [publicOrder.order_id],
      )).rows)
      assert(events.length >= 2, 'eventos de status')
      const last = events[events.length - 1]
      assert(last.from_status === 'new' && last.to_status === 'confirmed', 'transição registrada')
      assert(last.actor_user_id === USER_A, 'autor do evento')
    })

    await test('transição inválida é rejeitada', async () => {
      await expectError(
        () => asUser(USER_A, () => client.query(
          `update public.orders set status = 'new' where id = $1`,
          [publicOrder.order_id],
        )),
        'invalid_status_transition',
        'confirmed -> new',
      )
    })

    await test('A não altera pedido de B', async () => {
      const orderB = await asService(() => client.query(
        `insert into public.orders (organization_id, public_reference, status, buyer_name, buyer_phone)
         values ($1, 'PD-BBBBBBBBBB', 'new', 'Cliente B', '21966665555') returning id`,
        [orgB.id],
      ))
      const result = await asUser(USER_A, () => client.query(
        `update public.orders set status = 'confirmed' where id = $1`,
        [orderB.rows[0].id],
      ))
      assert(result.rowCount === 0, 'A alterou pedido B')
    })

    await test('evento de billing duplicado é inofensivo e idempotente', async () => {
      const first = await asService(() => client.query(
        `select * from app.register_billing_event('evt_duplicate_001', 'PAYMENT_RECEIVED', '{"value":29.9}'::jsonb)`,
      ))
      const second = await asService(() => client.query(
        `select * from app.register_billing_event('evt_duplicate_001', 'PAYMENT_RECEIVED', '{"value":29.9}'::jsonb)`,
      ))
      assert(first.rows[0].is_new === true, 'primeiro evento deveria ser novo')
      assert(second.rows[0].is_new === false, 'duplicado deveria ser detectado')
      assert(first.rows[0].event_id === second.rows[0].event_id, 'ids deveriam coincidir')
      await asService(() => client.query(`select app.mark_billing_event($1, 'processed', null)`, [first.rows[0].event_id]))
      const state = await client.query('select state from public.billing_events where id = $1', [first.rows[0].event_id])
      assert(state.rows[0].state === 'processed', 'state processed')
    })

    await test('billing event inválido é rejeitado', async () => {
      await expectError(
        () => asService(() => client.query(
          `select app.mark_billing_event('00000000-0000-4000-8000-000000000000', 'active', null)`,
        )),
        'invalid_billing_state',
        'mark state inválido',
      )
    })

    console.log('\n[7/8] Planos, entitlements, trial e admin')

    await test('catálogo contém exatamente os dois planos com preços aprovados', async () => {
      const plans = await client.query(
        `select plan_code, plan_version, price_cents, currency
           from public.plan_catalog
          order by plan_code`,
      )
      assert(plans.rows.length === 2, `esperava 2 planos, veio ${plans.rows.length}`)
      const byCode = Object.fromEntries(plans.rows.map((row) => [row.plan_code, row]))
      assert(byCode.essential.price_cents === 2990, 'preço Essencial')
      assert(byCode.professional.price_cents === 6990, 'preço Profissional')
      assert(byCode.essential.currency === 'BRL', 'moeda Essencial')
    })

    await test('matriz de features separa Essencial de Profissional', async () => {
      const essential = await client.query(
        `select enabled from public.plan_feature_entitlements
          where plan_code = 'essential' and plan_version = 1 and feature_key = 'private_prices'`,
      )
      const professional = await client.query(
        `select enabled from public.plan_feature_entitlements
          where plan_code = 'professional' and plan_version = 1 and feature_key = 'private_prices'`,
      )
      assert(essential.rows[0].enabled === false, 'Essencial não deve ter preço privado')
      assert(professional.rows[0].enabled === true, 'Profissional deve ter preço privado')
    })

    await test('trial vigente concede apenas Essencial', async () => {
      const plan = await asService(() =>
        client.query('select * from app.effective_plan($1)', [orgB.id]),
      )
      assert(plan.rows[0].plan_code === 'essential', `plano ${plan.rows[0].plan_code}`)
      assert(plan.rows[0].access_kind === 'trial', `kind ${plan.rows[0].access_kind}`)
      const pro = await asService(() =>
        client.query(`select app.has_entitlement($1, 'api_access') as allowed`, [orgB.id]),
      )
      assert(pro.rows[0].allowed === false, 'trial não pode ter API Profissional')
    })

    await test('assinatura Profissional ativa libera feature Pro; Essencial não', async () => {
      const essential = await asService(() =>
        client.query(`select app.has_entitlement($1, 'api_access') as allowed`, [orgA.id]),
      )
      assert(essential.rows[0].allowed === false, 'Essencial liberou API')

      await client.query(
        `update public.subscriptions
            set plan_code = 'professional', plan_version = 1, state = 'active',
                current_period_end = now() + interval '30 days'
          where organization_id = $1`,
        [orgA.id],
      )
      const professional = await asService(() =>
        client.query(`select app.has_entitlement($1, 'api_access') as allowed`, [orgA.id]),
      )
      assert(professional.rows[0].allowed === true, 'Profissional não liberou API')

      await client.query(
        `update public.subscriptions
            set plan_code = 'essential', plan_version = 1
          where organization_id = $1`,
        [orgA.id],
      )
      const revoked = await asService(() =>
        client.query(`select app.has_entitlement($1, 'api_access') as allowed`, [orgA.id]),
      )
      assert(revoked.rows[0].allowed === false, 'downgrade não revogou API')
    })

    await test('quota é atômica, isolada por tenant e auditável', async () => {
      async function consumeQuotaTimes(remaining, organizationId) {
        if (remaining === 0) return []
        const row = await asService(() =>
          client.query(`select app.consume_quota($1, 'db_test_quota', 3, 60) as allowed`, [
            organizationId,
          ]),
        )
        const rest = await consumeQuotaTimes(remaining - 1, organizationId)
        return [row.rows[0].allowed, ...rest]
      }

      const results = await consumeQuotaTimes(4, orgB.id)
      const allowedCount = results.filter(Boolean).length
      assert(
        JSON.stringify(results) === JSON.stringify([true, true, true, false]) &&
          allowedCount === 3,
        `resultado inesperado: ${JSON.stringify(results)}`,
      )
      const otherTenant = await asService(() =>
        client.query(`select app.consume_quota($1, 'db_test_quota', 3, 60) as allowed`, [
          orgA.id,
        ]),
      )
      assert(otherTenant.rows[0].allowed === true, 'quota vazou entre tenants')
    })

    await test('trial é único por usuário e sobrevive à recriação da organização', async () => {
      await client.query('insert into auth.users (id, email) values ($1, $2)', [
        USER_C,
        'c@example.test',
      ])
      const firstOrg = await createOrg(USER_C, 'Recicla Trial', '11911112222')
      const firstGrant = await client.query(
        'select ends_at, status from public.trial_grants where user_id = $1',
        [USER_C],
      )
      assert(firstGrant.rows[0].status === 'granted', 'primeiro trial deveria ser concedido')
      const firstEnds = new Date(firstGrant.rows[0].ends_at)

      await client.query('delete from public.organizations where id = $1', [firstOrg.id])
      const surviving = await client.query(
        'select organization_id, ends_at from public.trial_grants where user_id = $1',
        [USER_C],
      )
      assert(surviving.rows[0].organization_id === null, 'grant deveria sobreviver sem org')

      const secondOrg = await createOrg(USER_C, 'Recicla Trial Dois', '11911113333')
      const second = await client.query(
        'select organization_id, ends_at from public.trial_grants where user_id = $1',
        [USER_C],
      )
      assert(second.rows[0].organization_id === secondOrg.id, 'grant não religado')
      assert(
        new Date(second.rows[0].ends_at).getTime() <= firstEnds.getTime(),
        'trial foi reiniciado na recriação',
      )
    })

    await test('telefone repetido abre revisão sem bloquear o trial', async () => {
      await client.query('insert into auth.users (id, email) values ($1, $2)', [
        USER_D,
        'd@example.test',
      ])
      const orgD = await createOrg(USER_D, 'Telefone Repetido', '11999998888')
      const grant = await client.query(
        'select status, risk_score from public.trial_grants where user_id = $1',
        [USER_D],
      )
      assert(grant.rows[0].risk_score >= 25, `risco ${grant.rows[0].risk_score}`)
      assert(grant.rows[0].status === 'review_required', 'telefone repetido deve abrir revisão')
      const access = await client.query(
        'select access_state from public.organizations where id = $1',
        [orgD.id],
      )
      assert(access.rows[0].access_state === 'trial', 'trial deveria continuar ativo')
    })

    await test('e-mail repetido abre revisão manual, e admin pode limpar/suspender', async () => {
      await client.query('insert into auth.users (id, email) values ($1, $2)', [
        USER_F,
        'f@example.test',
      ])
      const orgF = await client.query(
        `insert into public.organizations (owner_user_id, name, slug, whatsapp)
         values ($1, 'Revisão Trial', 'revisao-trial-test', '11955554444')
         returning id`,
        [USER_F],
      )
      const grant = await asService(() =>
        client.query(
          `select * from app.record_trial_grant($1, $2, 'a@example.test', '11955554444')`,
          [orgF.rows[0].id, USER_F],
        ),
      )
      assert(grant.rows[0].status === 'review_required', `status ${grant.rows[0].status}`)
      assert(grant.rows[0].risk_score >= 35, `risco ${grant.rows[0].risk_score}`)

      const bootstrap = await asService(() =>
        client.query('select * from public.api_admin_bootstrap($1)', [USER_A]),
      )
      assert(bootstrap.rows[0].user_id === USER_A, 'bootstrap do admin')
      await expectError(
        () =>
          asService(() =>
            client.query('select * from public.api_admin_bootstrap($1)', [USER_B]),
          ),
        'admin_exists',
        'segundo admin',
      )

      const cleared = await asService(() =>
        client.query(
          `select public.api_admin_review_trial($1, $2, 'clear_review', 'revisão manual concluída')`,
          [USER_A, orgF.rows[0].id],
        ),
      )
      assert(cleared.rows[0].api_admin_review_trial === 'granted', 'clear review')

      const suspended = await asService(() =>
        client.query(
          `select public.api_admin_set_org_access($1, $2, 'suspend', 'teste de suspensão')`,
          [USER_A, orgF.rows[0].id],
        ),
      )
      assert(suspended.rows[0].api_admin_set_org_access === 'blocked', 'suspensão')

      const reactivated = await asService(() =>
        client.query(
          `select public.api_admin_set_org_access($1, $2, 'reactivate', 'teste de reativação')`,
          [USER_A, orgF.rows[0].id],
        ),
      )
      assert(reactivated.rows[0].api_admin_set_org_access === 'trial', 'reativação')

      const audit = await client.query(
        `select action, actor_user_id from public.platform_audit_events
          where target_organization_id = $1 order by created_at`,
        [orgF.rows[0].id],
      )
      assert(audit.rows.length >= 2, `auditoria insuficiente: ${audit.rows.length}`)
      assert(audit.rows.every((row) => row.actor_user_id === USER_A), 'ator da auditoria')
    })

    await test('admin é singleton e funções globais são exclusivas de service_role', async () => {
      await expectError(
        () =>
          client.query(
            `insert into public.platform_admins (singleton, user_id) values (true, $1)`,
            [USER_B],
          ),
        'duplicate key',
        'segundo superadmin',
      )
      await expectError(
        () =>
          client.query(
            `insert into public.trial_grants (organization_id, user_id, ends_at)
             values ($1, $2, now() + interval '7 days')`,
            [orgB.id, USER_C],
          ),
        'duplicate key',
        'trial duplicado por usuário',
      )
      await expectError(
        () => asUser(USER_A, () => client.query('select * from public.api_admin_overview()')),
        'permission denied',
        'authenticated chamando admin overview',
      )
      const overview = await asService(() =>
        client.query('select * from public.api_admin_overview()'),
      )
      assert(overview.rows.length === 1, 'overview deveria retornar uma linha')
      const list = await asService(() =>
        client.query(
          `select * from public.api_admin_list_organizations(null, null, null, 2, 0)`,
        ),
      )
      assert(list.rows.length === 2, `paginação retornou ${list.rows.length}`)
      assert(Number(list.rows[0].total_count) >= 2, 'total_count')
    })


    console.log('\n[8/8] Categorias e mídia de produto')

    await test('categoria é isolada por tenant e gera slug', async () => {
      const category = await asUser(USER_A, () =>
        client.query(
          `insert into public.product_categories (organization_id, name)
           values ($1, 'Bebidas') returning *`,
          [orgA.id],
        ),
      )
      assert(category.rows[0].slug === 'bebidas', `slug ${category.rows[0].slug}`)
      const seenByB = await asUser(USER_B, () =>
        client.query('select id from public.product_categories'),
      )
      assert(seenByB.rows.length === 0, 'B viu categoria de A')
      await expectError(
        () =>
          asUser(USER_B, () =>
            client.query(
              `insert into public.product_categories (organization_id, name)
               values ($1, 'Invasão')`,
              [orgA.id],
            ),
          ),
        'row-level security',
        'B inserindo categoria em A',
      )
    })

    await test('produto aceita categoria do próprio tenant e rejeita de outro', async () => {
      const category = await client.query(
        `select id from public.product_categories where organization_id = $1 limit 1`,
        [orgA.id],
      )
      await asUser(USER_A, () =>
        client.query(`update public.products set category_id = $1 where id = $2`, [
          category.rows[0].id,
          productA1.id,
        ]),
      )
      const updated = await client.query('select category_id from public.products where id = $1', [
        productA1.id,
      ])
      assert(updated.rows[0].category_id === category.rows[0].id, 'categoria não vinculada')
      const crossTenant = await asUser(USER_A, () =>
        client.query(`update public.products set category_id = $1 where id = $2`, [
          category.rows[0].id,
          productB.id,
        ]),
      )
      assert(crossTenant.rowCount === 0, 'A alterou produto B')
    })

    await test('metadados de imagem são isolados e exigem path do tenant', async () => {
      const imageId = crypto.randomUUID()
      const path = `${orgA.id}/${productA1.id}/${imageId}.jpg`
      await asUser(USER_A, () =>
        client.query(
          `insert into public.product_images
             (id, organization_id, product_id, storage_path, alt_text, is_cover)
           values ($1, $2, $3, $4, 'Copo de água', true)`,
          [imageId, orgA.id, productA1.id, path],
        ),
      )
      const seenByB = await asUser(USER_B, () =>
        client.query('select id from public.product_images'),
      )
      assert(seenByB.rows.length === 0, 'B viu imagem de A')
      await expectError(
        () =>
          asUser(USER_B, () =>
            client.query(
              `insert into public.product_images
                 (organization_id, product_id, storage_path, alt_text)
               values ($1, $2, $3, 'Invasão')`,
              [orgA.id, productA1.id, `${orgA.id}/${productA1.id}/${crypto.randomUUID()}.jpg`],
            ),
          ),
        'row-level security',
        'B inserindo imagem em A',
      )
      await expectError(
        () =>
          asUser(USER_A, () =>
            client.query(
              `insert into public.product_images
                 (organization_id, product_id, storage_path, alt_text)
               values ($1, $2, $3, 'Path cruzado')`,
              [orgA.id, productA1.id, `${orgB.id}/${productA1.id}/${crypto.randomUUID()}.jpg`],
            ),
          ),
        'product_images_path_tenant',
        'path de outro tenant',
      )
    })

    await test('capa é única e o RPC de capa troca atomicamente', async () => {
      const first = await client.query(
        'select id from public.product_images where product_id = $1 and is_cover = true',
        [productA1.id],
      )
      const secondId = crypto.randomUUID()
      await client
        .query(
          `insert into public.product_images
             (id, organization_id, product_id, storage_path, alt_text, is_cover)
           values ($1, $2, $3, $4, 'Segunda foto', true)`,
          [secondId, orgA.id, productA1.id, `${orgA.id}/${productA1.id}/${secondId}.jpg`],
        )
        .then(
          () => {
            throw new Error('capa duplicada foi aceita')
          },
          (error) => {
            assert(
              String(error.message).includes('product_images_one_cover_idx'),
              `erro inesperado: ${error.message}`,
            )
          },
        )
      // A tentativa acima não cria a segunda imagem; insere sem capa para o RPC.
      await client.query(
        `insert into public.product_images
           (id, organization_id, product_id, storage_path, alt_text, is_cover)
         values ($1, $2, $3, $4, 'Segunda foto', false)`,
        [secondId, orgA.id, productA1.id, `${orgA.id}/${productA1.id}/${secondId}.jpg`],
      )

      await asService(() =>
        client.query('select public.api_set_product_image_cover($1, $2)', [
          orgA.id,
          secondId,
        ]),
      )
      const covers = await client.query(
        `select id, is_cover from public.product_images
          where product_id = $1 order by created_at`,
        [productA1.id],
      )
      assert(
        covers.rows.filter((row) => row.is_cover).length === 1 &&
          covers.rows.find((row) => row.is_cover).id === secondId,
        'capa não trocou',
      )
      assert(
        covers.rows.find((row) => row.id === first.rows[0].id).is_cover === false,
        'capa antiga permaneceu',
      )
    })

    await test('RPC de mídia valida path e remove metadado', async () => {
      await expectError(
        () =>
          asService(() =>
            client.query(
              `select public.api_add_product_image($1, $2, $3, null, 'Path errado', 0, false, $4)`,
              [orgA.id, productA1.id, `${orgB.id}/${productA1.id}/${crypto.randomUUID()}.jpg`, USER_A],
            ),
          ),
        'invalid_storage_path',
        'path inválido no RPC',
      )

      const imageId = crypto.randomUUID()
      const path = `${orgA.id}/${productA1.id}/${imageId}.jpg`
      const inserted = await asService(() =>
        client.query(
          `select * from public.api_add_product_image($1, $2, $3, null, 'Foto removível', 1, false, $4)`,
          [orgA.id, productA1.id, path, USER_A],
        ),
      )
      const rowId = inserted.rows[0].id
      const deleted = await asService(() =>
        client.query('select * from public.api_delete_product_image($1, $2)', [
          orgA.id,
          rowId,
        ]),
      )
      assert(deleted.rows[0].storage_path === path, 'path de retorno')
      const remaining = await client.query('select id from public.product_images where id = $1', [
        rowId,
      ])
      assert(remaining.rows.length === 0, 'metadado não removido')
    })


    await test('SKU é normalizado e único por tenant', async () => {
      await asUser(USER_A, () =>
        client.query(`update public.products set sku = 'copo-200' where id = $1`, [
          productA2.id,
        ]),
      )
      const normalized = await client.query('select sku from public.products where id = $1', [
        productA2.id,
      ])
      assert(normalized.rows[0].sku === 'COPO-200', `sku ${normalized.rows[0].sku}`)

      await expectError(
        () =>
          asUser(USER_A, () =>
            client.query(`update public.products set sku = 'COPO-200' where id = $1`, [
              productA1.id,
            ]),
          ),
        'products_org_sku_unique',
        'SKU duplicado no mesmo tenant',
      )

      await asUser(USER_B, () =>
        client.query(`update public.products set sku = 'COPO-200' where id = $1`, [
          productB.id,
        ]),
      )
      const crossTenant = await client.query('select sku from public.products where id = $1', [
        productB.id,
      ])
      assert(crossTenant.rows[0].sku === 'COPO-200', 'SKU deveria ser permitido em outro tenant')

      await expectError(
        () =>
          asUser(USER_A, () =>
            client.query(`update public.products set sku = 'a' where id = $1`, [productA1.id]),
          ),
        'products_sku_format',
        'SKU curto',
      )
    })


    await test('regras de quantidade e mínimo são aplicadas no servidor', async () => {
      await client.query(
        `update public.products set min_quantity = 12, quantity_increment = 12 where id = $1`,
        [productA1.id],
      )
      const submit = (items, requestId) =>
        asService(() =>
          client.query(
            `select * from app.submit_order($1, 'Teste Regras', '11999998888', '', $2::jsonb, $3, null, 'catalog', $4)`,
            [orgA.slug, JSON.stringify(items), `rules:${requestId}`, requestId],
          ),
        )

      await expectError(
        () => submit([{ product_id: productA1.id, quantity: 6 }], crypto.randomUUID()),
        'quantity_below_minimum',
        'quantidade abaixo do mínimo',
      )
      await expectError(
        () => submit([{ product_id: productA1.id, quantity: 13 }], crypto.randomUUID()),
        'quantity_not_multiple',
        'quantidade fora do múltiplo',
      )
      const ok = await submit([{ product_id: productA1.id, quantity: 12 }], crypto.randomUUID())
      assert(ok.rows[0].total_cents === 15000, `total ${ok.rows[0].total_cents}`)

      await client.query(
        `update public.organizations set min_order_cents = 20000 where id = $1`,
        [orgA.id],
      )
      await expectError(
        () => submit([{ product_id: productA1.id, quantity: 12 }], crypto.randomUUID()),
        'order_below_minimum',
        'pedido abaixo do valor mínimo',
      )

      await client.query(
        `update public.organizations set min_order_cents = null, min_order_items = 2 where id = $1`,
        [orgA.id],
      )
      await expectError(
        () => submit([{ product_id: productA1.id, quantity: 12 }], crypto.randomUUID()),
        'order_below_minimum_items',
        'pedido abaixo da quantidade mínima de itens',
      )

      await client.query(`update public.products set price_cents = null where id = $1`, [
        productA2.id,
      ])
      await client.query(
        `update public.organizations set min_order_items = null, min_order_cents = 1000 where id = $1`,
        [orgA.id],
      )
      await expectError(
        () => submit([{ product_id: productA2.id, quantity: 1 }], crypto.randomUUID()),
        'minimum_unverifiable',
        'mínimo sem preço verificável',
      )

      await client.query(
        `update public.products set price_cents = 899, min_quantity = 1, quantity_increment = 1 where id = $1`,
        [productA2.id],
      )
      await client.query(
        `update public.products set min_quantity = 1, quantity_increment = 1 where id = $1`,
        [productA1.id],
      )
      await client.query(
        `update public.organizations set min_order_cents = null, min_order_items = null where id = $1`,
        [orgA.id],
      )
    })


    await test('importação cria, atualiza e é idempotente por job', async () => {
      const jobId = crypto.randomUUID()
      const rows = [
        {
          line: 2,
          action: 'create',
          name: 'Produto Importado',
          sku: 'IMP-1',
          category: 'Importados',
          unit: 'un',
          price_cents: 1000,
          active: true,
          min_quantity: 1,
          quantity_increment: 1,
        },
        {
          line: 3,
          action: 'update',
          name: 'Copo Atualizado',
          sku: 'COPO-200',
          category: null,
          unit: 'cento',
          price_cents: 1300,
          active: true,
          min_quantity: 1,
          quantity_increment: 1,
        },
      ]
      const first = await asService(() =>
        client.query(
          `select * from public.api_import_products($1, $2, $3, $4::jsonb)`,
          [jobId, orgA.id, USER_A, JSON.stringify(rows)],
        ),
      )
      assert(first.rows[0].created_count === 1, `created ${first.rows[0].created_count}`)
      assert(first.rows[0].updated_count === 1, `updated ${first.rows[0].updated_count}`)
      const imported = await client.query(
        `select id, category_id from public.products where organization_id = $1 and sku = 'IMP-1'`,
        [orgA.id],
      )
      assert(imported.rows.length === 1, 'produto importado ausente')
      const category = await client.query(
        `select id from public.product_categories where organization_id = $1 and name = 'Importados'`,
        [orgA.id],
      )
      assert(category.rows.length === 1, 'categoria importada ausente')
      assert(imported.rows[0].category_id === category.rows[0].id, 'categoria não vinculada')
      const updated = await client.query('select name, price_cents from public.products where id = $1', [
        productA2.id,
      ])
      assert(updated.rows[0].name === 'Copo Atualizado', 'update de nome')
      assert(updated.rows[0].price_cents === 1300, 'update de preço')

      const second = await asService(() =>
        client.query(
          `select * from public.api_import_products($1, $2, $3, $4::jsonb)`,
          [jobId, orgA.id, USER_A, JSON.stringify(rows)],
        ),
      )
      assert(second.rows[0].created_count === 1, 'job não foi idempotente')
      const count = await client.query(
        `select count(*)::integer as total from public.products where organization_id = $1 and sku = 'IMP-1'`,
        [orgA.id],
      )
      assert(count.rows[0].total === 1, 'produto duplicado pelo job')
    })

    await test('importação rejeita SKU duplicado no arquivo e tenant divergente', async () => {
      const jobId = crypto.randomUUID()
      const duplicateRows = [
        { line: 2, action: 'auto', name: 'Duplicado A', sku: 'DUP-1', unit: 'un' },
        { line: 3, action: 'auto', name: 'Duplicado B', sku: 'DUP-1', unit: 'un' },
      ]
      await expectError(
        () =>
          asService(() =>
            client.query(
              `select * from public.api_import_products($1, $2, $3, $4::jsonb)`,
              [jobId, orgA.id, USER_A, JSON.stringify(duplicateRows)],
            ),
          ),
        'duplicate_import_sku',
        'SKU duplicado na importação',
      )
      const notCreated = await client.query(
        `select id from public.products where organization_id = $1 and sku = 'DUP-1'`,
        [orgA.id],
      )
      assert(notCreated.rows.length === 0, 'importação parcial deixou produto')

      const tenantJob = crypto.randomUUID()
      await asService(() =>
        client.query(
          `select * from public.api_import_products($1, $2, $3, $4::jsonb)`,
          [
            tenantJob,
            orgA.id,
            USER_A,
            JSON.stringify([
              { line: 2, action: 'create', name: 'Job Tenant', sku: 'JOB-T', unit: 'un' },
            ]),
          ],
        ),
      )
      await expectError(
        () =>
          asService(() =>
            client.query(
              `select * from public.api_import_products($1, $2, $3, $4::jsonb)`,
              [
                tenantJob,
                orgB.id,
                USER_A,
                JSON.stringify([
                  { line: 2, action: 'create', name: 'Outro', sku: 'JOB-T2', unit: 'un' },
                ]),
              ],
            ),
          ),
        'job_tenant_mismatch',
        'job de outro tenant',
      )
      await expectError(
        () => asUser(USER_A, () => client.query('select id from public.product_import_jobs')),
        'permission denied',
        'fornecedor lendo jobs de importação',
      )
    })


    await test('template cria somente itens escolhidos e é idempotente', async () => {
      const jobId = crypto.randomUUID()
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
      const first = await asService(() =>
        client.query(
          `select * from public.api_seed_catalog($1, $2, $3, 'packaging', 1, $4::jsonb)`,
          [jobId, orgA.id, USER_A, JSON.stringify(items)],
        ),
      )
      assert(first.rows[0].created_count === 2, `created ${first.rows[0].created_count}`)
      assert(first.rows[0].skipped_count === 0, `skipped ${first.rows[0].skipped_count}`)
      const created = await client.query(
        `select id, price_cents, active from public.products
          where organization_id = $1 and name = 'Copo descartável 200ml'`,
        [orgA.id],
      )
      assert(created.rows.length === 1, 'produto do template ausente')
      assert(created.rows[0].price_cents === null, 'template não pode inventar preço')
      assert(created.rows[0].active === true, 'produto deveria ficar ativo')

      const retry = await asService(() =>
        client.query(
          `select * from public.api_seed_catalog($1, $2, $3, 'packaging', 1, $4::jsonb)`,
          [jobId, orgA.id, USER_A, JSON.stringify(items)],
        ),
      )
      assert(retry.rows[0].created_count === 2, 'job não idempotente')

      const newJob = crypto.randomUUID()
      const rerun = await asService(() =>
        client.query(
          `select * from public.api_seed_catalog($1, $2, $3, 'packaging', 1, $4::jsonb)`,
          [newJob, orgA.id, USER_A, JSON.stringify(items)],
        ),
      )
      assert(rerun.rows[0].created_count === 0, 'novo job duplicou produtos')
      assert(rerun.rows[0].skipped_count === 2, 'itens já semeados deveriam ser ignorados')
    })

    await test('template ignora conflito por nome e não cruza tenant', async () => {
      await client.query(`update public.products set name = 'Copo descartável 300ml' where id = $1`, [
        productA2.id,
      ])
      const jobId = crypto.randomUUID()
      const items = [
        {
          item_key: 'copo-300',
          name: 'Copo descartável 300ml',
          category: 'Copos e potes',
          unit: 'cento',
          min_quantity: 1,
          quantity_increment: 1,
        },
      ]
      const result = await asService(() =>
        client.query(
          `select * from public.api_seed_catalog($1, $2, $3, 'packaging', 1, $4::jsonb)`,
          [jobId, orgA.id, USER_A, JSON.stringify(items)],
        ),
      )
      assert(result.rows[0].created_count === 0, 'conflito por nome deveria ser ignorado')
      assert(result.rows[0].skipped_count === 1, 'conflito não contabilizado')
      const linked = await client.query(
        `select product_id from public.catalog_seed_items
          where organization_id = $1 and template_code = 'packaging' and item_key = 'copo-300'`,
        [orgA.id],
      )
      assert(linked.rows[0].product_id === productA2.id, 'seed não apontou produto existente')
      const price = await client.query('select price_cents from public.products where id = $1', [
        productA2.id,
      ])
      assert(price.rows[0].price_cents === 1300, 'template sobrescreveu preço existente')

      await expectError(
        () =>
          asService(() =>
            client.query(
              `select * from public.api_seed_catalog($1, $2, $3, 'packaging', 1, $4::jsonb)`,
              [jobId, orgB.id, USER_A, JSON.stringify(items)],
            ),
          ),
        'seed_job_tenant_mismatch',
        'job de seed de outro tenant',
      )
      await expectError(
        () => asUser(USER_A, () => client.query('select id from public.catalog_seed_jobs')),
        'permission denied',
        'fornecedor lendo jobs de template',
      )
    })


    await test('tracking armazena hash, exige um link ativo e não vaza para fornecedor', async () => {
      const order = await client.query(
        `select id from public.orders where organization_id = $1 order by created_at desc limit 1`,
        [orgA.id],
      )
      assert(order.rows.length === 1, 'pedido sintético ausente')
      const orderId = order.rows[0].id
      const first = await client.query(
        `insert into public.order_tracking_links
           (organization_id, order_id, token_hash, expires_at)
         values ($1, $2, $3, now() + interval '30 days') returning id`,
        [orgA.id, orderId, 'c'.repeat(64)],
      )
      await expectError(
        () =>
          client.query(
            `insert into public.order_tracking_links
               (organization_id, order_id, token_hash, expires_at)
             values ($1, $2, $3, now() + interval '30 days')`,
            [orgA.id, orderId, 'd'.repeat(64)],
          ),
        'order_tracking_links_one_active_idx',
        'segundo link ativo',
      )
      await client.query(
        `update public.order_tracking_links set revoked_at = now() where id = $1`,
        [first.rows[0].id],
      )
      await client.query(
        `insert into public.order_tracking_links
           (organization_id, order_id, token_hash, expires_at)
         values ($1, $2, $3, now() + interval '30 days')`,
        [orgA.id, orderId, 'd'.repeat(64)],
      )
      await expectError(
        () => asUser(USER_A, () => client.query('select id from public.order_tracking_links')),
        'permission denied',
        'fornecedor lendo tracking links',
      )
      await client.query(
        `update public.order_tracking_links set revoked_at = now()
          where organization_id = $1 and order_id = $2 and revoked_at is null`,
        [orgA.id, orderId],
      )
      await expectError(
        () =>
          client.query(
            `insert into public.order_tracking_links
               (organization_id, order_id, token_hash, expires_at)
             values ($1, $2, $3, now() + interval '30 days')`,
            [orgB.id, orderId, 'e'.repeat(64)],
          ),
        'order_tracking_links_order_fk',
        'link cross-tenant',
      )
    })


    await test('preço privado exige token, aplica fallback e preserva snapshot', async () => {
      await client.query(
        `update public.subscriptions
            set plan_code = 'professional', plan_version = 1, state = 'active',
                current_period_end = now() + interval '30 days'
          where organization_id = $1`,
        [orgA.id],
      )
      const list = await client.query(
        `insert into public.price_lists (organization_id, name)
         values ($1, 'Tabela Ouro') returning id`,
        [orgA.id],
      )
      await client.query(
        `insert into public.price_list_items
           (organization_id, price_list_id, product_id, price_cents, valid_from)
         values ($1, $2, $3, 1000, now() - interval '1 day')`,
        [orgA.id, list.rows[0].id, productA1.id],
      )
      await client.query(
        `insert into public.customer_price_list_assignments
           (organization_id, customer_id, price_list_id)
         values ($1, $2, $3)`,
        [orgA.id, customerA.id, list.rows[0].id],
      )
      const token = 'price-token-test-0123456789abcdef'
      await client.query(
        `insert into public.customer_price_tokens
           (organization_id, customer_id, token_hash, expires_at)
         values ($1, $2, encode(extensions.digest($3, 'sha256'), 'hex'), now() + interval '7 days')`,
        [orgA.id, customerA.id, token],
      )

      const requestId = crypto.randomUUID()
      const result = await asService(() =>
        client.query(
          `select * from app.submit_order($1, null, null, '', $2::jsonb, $3, null, 'private', $4, $5)`,
          [
            orgA.slug,
            JSON.stringify([
              { product_id: productA1.id, quantity: 1 },
              { product_id: productA2.id, quantity: 1 },
            ]),
            `price-order:${requestId}`,
            requestId,
            token,
          ],
        ),
      )
      assert(result.rows[0].total_cents === 2300, `total ${result.rows[0].total_cents}`)
      const order = await client.query(
        `select customer_id, price_list_id, price_source, total_cents
           from public.orders where id = $1`,
        [result.rows[0].order_id],
      )
      assert(order.rows[0].customer_id === customerA.id, 'cliente do token')
      assert(order.rows[0].price_list_id === list.rows[0].id, 'price list')
      assert(order.rows[0].price_source === 'private', 'price source')
      const items = await client.query(
        `select product_id, unit_price_cents from public.order_items
          where order_id = $1 order by product_id`,
        [result.rows[0].order_id],
      )
      const byProduct = Object.fromEntries(items.rows.map((row) => [row.product_id, row.unit_price_cents]))
      assert(byProduct[productA1.id] === 1000, 'preço privado não aplicado')
      assert(byProduct[productA2.id] === 1300, 'fallback público não aplicado')

      await client.query(
        `delete from public.customer_price_list_assignments
          where organization_id = $1 and customer_id = $2`,
        [orgA.id, customerA.id],
      )
      await expectError(
        () =>
          asService(() =>
            client.query(
              `select * from app.submit_order($1, null, null, '', $2::jsonb, $3, null, 'private', $4, $5)`,
              [
                orgA.slug,
                JSON.stringify([{ product_id: productA1.id, quantity: 1 }]),
                `price-no-list:${crypto.randomUUID()}`,
                crypto.randomUUID(),
                token,
              ],
            ),
          ),
        'invalid_price_token',
        'token sem tabela ativa',
      )
      await client.query(
        `insert into public.customer_price_list_assignments
           (organization_id, customer_id, price_list_id)
         values ($1, $2, $3)`,
        [orgA.id, customerA.id, list.rows[0].id],
      )

      await expectError(
        () =>
          asService(() =>
            client.query(
              `select * from app.submit_order($1, null, null, '', $2::jsonb, $3, null, 'private', $4, 'token-errado')`,
              [
                orgA.slug,
                JSON.stringify([{ product_id: productA1.id, quantity: 1 }]),
                `price-bad:${crypto.randomUUID()}`,
                crypto.randomUUID(),
              ],
            ),
          ),
        'invalid_price_token',
        'token de preço inválido',
      )

      await client.query(
        `update public.customer_price_tokens
            set created_at = now() - interval '10 days', expires_at = now() - interval '1 day'
          where organization_id = $1 and customer_id = $2`,
        [orgA.id, customerA.id],
      )
      await expectError(
        () =>
          asService(() =>
            client.query(
              `select * from app.submit_order($1, null, null, '', $2::jsonb, $3, null, 'private', $4, $5)`,
              [
                orgA.slug,
                JSON.stringify([{ product_id: productA1.id, quantity: 1 }]),
                `price-exp:${crypto.randomUUID()}`,
                crypto.randomUUID(),
                token,
              ],
            ),
          ),
        'invalid_price_token',
        'token expirado',
      )
    })

    await test('preço privado é Profissional e RLS isola listas', async () => {
      const isolated = await asUser(USER_B, () =>
        client.query('select id from public.price_lists where organization_id = $1', [orgA.id]),
      )
      assert(isolated.rows.length === 0, 'B não deveria ver listas de A')
      await client.query(
        `update public.subscriptions
            set plan_code = 'essential', plan_version = 1, state = 'active',
                current_period_end = now() + interval '30 days'
          where organization_id = $1`,
        [orgA.id],
      )
      await expectError(
        () =>
          asUser(USER_A, () =>
            client.query(
              `insert into public.price_lists (organization_id, name) values ($1, 'Bloqueada')`,
              [orgA.id],
            ),
          ),
        'row-level security',
        'Essencial criando lista privada',
      )
      const history = await asUser(USER_A, () =>
        client.query('select id from public.price_lists where organization_id = $1', [orgA.id]),
      )
      assert(history.rows.length >= 1, 'histórico de lista deveria permanecer legível')
    })


    await test('RPCs de preço privado não são executáveis pelo browser', async () => {
      const result = await client.query(`
        select
          has_function_privilege(
            'authenticated',
            'app.submit_order(text,text,text,text,jsonb,text,uuid,text,uuid,text,boolean)',
            'EXECUTE'
          ) as submit_order,
          has_function_privilege(
            'authenticated',
            'app.customer_price(uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) as customer_price,
          has_function_privilege(
            'authenticated',
            'public.api_submit_order(text,text,text,text,jsonb,text,uuid,text,boolean)',
            'EXECUTE'
          ) as api_submit
      `)
      assert(result.rows[0].submit_order === false, 'app.submit_order exposto')
      assert(result.rows[0].customer_price === false, 'app.customer_price exposto')
      assert(result.rows[0].api_submit === false, 'api_submit_order exposto')
    })


    console.log('[9/9] Orçamentos')

    async function quoteHash(token) {
      const result = await client.query(
        `select encode(extensions.digest($1, 'sha256'), 'hex') as hash`,
        [token],
      )
      return result.rows[0].hash
    }

    async function createQuote(items, notes = 'Condições de teste') {
      const result = await asService(() =>
        client.query(
          `select * from public.api_create_quote($1, $2, $3, $4::jsonb, now() + interval '7 days', $5)`,
          [orgA.id, USER_A, customerA.id, JSON.stringify(items), notes],
        ),
      )
      return result.rows[0]
    }

    await test('orçamento congela preço privado, envia e aceita uma única vez', async () => {
      await client.query(
        `update public.subscriptions
            set plan_code = 'professional', plan_version = 1, state = 'active',
                current_period_end = now() + interval '30 days'
          where organization_id = $1`,
        [orgA.id],
      )

      const created = await createQuote([
        { product_id: productA1.id, quantity: 1 },
        { product_id: productA2.id, quantity: 1 },
      ])
      assert(created.total_cents === 2300, `total ${created.total_cents}`)
      assert(created.item_count === 2, `itens ${created.item_count}`)
      const quoteId = created.quote_id
      const items = await client.query(
        `select product_id, unit_price_cents, price_source
           from public.quote_items where quote_id = $1 order by product_id`,
        [quoteId],
      )
      const itemByProduct = Object.fromEntries(
        items.rows.map((row) => [row.product_id, row]),
      )
      assert(itemByProduct[productA1.id].unit_price_cents === 1000, 'preço privado no snapshot')
      assert(itemByProduct[productA1.id].price_source === 'private', 'origem privada')
      assert(itemByProduct[productA2.id].unit_price_cents === 1300, 'fallback público')
      assert(itemByProduct[productA2.id].price_source === 'public', 'origem pública')

      const updated = await asService(() =>
        client.query(
          `select * from public.api_update_quote($1, $2, $3, $4, $5::jsonb, now() + interval '7 days', $6)`,
          [
            orgA.id,
            USER_A,
            quoteId,
            1,
            JSON.stringify([{ product_id: productA1.id, quantity: 2 }]),
            'Revisado',
          ],
        ),
      )
      assert(updated.rows[0].total_cents === 2000, `update total ${updated.rows[0].total_cents}`)
      assert(updated.rows[0].version === 2, `versão ${updated.rows[0].version}`)

      const token = 'quote-token-test-0123456789abcdefghijklmno'
      const hash = await quoteHash(token)
      const sent = await asService(() =>
        client.query(
          `select * from public.api_send_quote($1, $2, $3, $4, $5, now() + interval '7 days')`,
          [orgA.id, USER_A, quoteId, 2, hash],
        ),
      )
      assert(sent.rows[0].version === 3, `envio versão ${sent.rows[0].version}`)
      const quoteState = await client.query(
        `select status, total_cents, version from public.quotes where id = $1`,
        [quoteId],
      )
      assert(quoteState.rows[0].status === 'sent', 'status enviado')

      const requestId = crypto.randomUUID()
      const accepted = await asService(() =>
        client.query(`select * from public.api_accept_quote($1, $2, 'test-agent')`, [
          hash,
          requestId,
        ]),
      )
      assert(accepted.rows[0].order_id, 'pedido não criado')
      assert(accepted.rows[0].total_cents === 2000, 'total aceito')
      assert(accepted.rows[0].already_accepted === false, 'primeiro aceite')

      const order = await client.query(
        `select source, quote_id, customer_id, buyer_name, buyer_phone,
                price_source, price_list_id, total_cents
           from public.orders where id = $1`,
        [accepted.rows[0].order_id],
      )
      assert(order.rows[0].source === 'quote', 'origem quote')
      assert(order.rows[0].quote_id === quoteId, 'correlação quote')
      assert(order.rows[0].customer_id === customerA.id, 'cliente do orçamento')
      assert(order.rows[0].buyer_name === null && order.rows[0].buyer_phone === null, 'PII')
      assert(order.rows[0].price_source === 'private', 'preço privado no pedido')
      assert(order.rows[0].total_cents === 2000, 'total do pedido')
      const orderItems = await client.query(
        `select count(*)::integer as total, min(unit_price_cents) as price
           from public.order_items where order_id = $1`,
        [accepted.rows[0].order_id],
      )
      assert(orderItems.rows[0].total === 1, 'itens do pedido')
      assert(orderItems.rows[0].price === 1000, 'preço do item')

      const after = await client.query(
        `select status, order_id from public.quotes where id = $1`,
        [quoteId],
      )
      assert(after.rows[0].status === 'accepted', 'status aceito')
      assert(after.rows[0].order_id === accepted.rows[0].order_id, 'order_id na quote')
      const link = await client.query(
        `select revoked_at from public.quote_links where quote_id = $1`,
        [quoteId],
      )
      assert(link.rows[0].revoked_at !== null, 'link não revogado')

      const replay = await asService(() =>
        client.query(`select * from public.api_accept_quote($1, $2, 'test-agent')`, [
          hash,
          requestId,
        ]),
      )
      assert(replay.rows[0].already_accepted === true, 'replay não idempotente')
      assert(replay.rows[0].order_id === accepted.rows[0].order_id, 'pedido diferente')
      const count = await client.query(
        `select count(*)::integer as total from public.orders where quote_id = $1`,
        [quoteId],
      )
      assert(count.rows[0].total === 1, 'pedido duplicado')
    })

    await test('reenvio rotaciona o link e invalida o anterior', async () => {
      const created = await createQuote([{ product_id: productA2.id, quantity: 1 }])
      const firstToken = 'quote-rotate-first-0123456789abcdefghij'
      const secondToken = 'quote-rotate-second-0123456789abcdefghij'
      const firstHash = await quoteHash(firstToken)
      const secondHash = await quoteHash(secondToken)
      await asService(() =>
        client.query(
          `select * from public.api_send_quote($1, $2, $3, 1, $4, now() + interval '7 days')`,
          [orgA.id, USER_A, created.quote_id, firstHash],
        ),
      )
      const rotated = await asService(() =>
        client.query(
          `select * from public.api_send_quote($1, $2, $3, 2, $4, now() + interval '7 days')`,
          [orgA.id, USER_A, created.quote_id, secondHash],
        ),
      )
      assert(rotated.rows[0].version === 3, `rotação versão ${rotated.rows[0].version}`)
      await expectError(
        () =>
          asService(() =>
            client.query(`select * from public.api_accept_quote($1, $2, null)`, [
              firstHash,
              crypto.randomUUID(),
            ]),
          ),
        'quote_link_unavailable',
        'link antigo ainda válido',
      )
      const accepted = await asService(() =>
        client.query(`select * from public.api_accept_quote($1, $2, null)`, [
          secondHash,
          crypto.randomUUID(),
        ]),
      )
      assert(accepted.rows[0].order_id, 'link novo não aceitou')
    })

    await test('orçamento expirado não vira pedido', async () => {
      const created = await createQuote([{ product_id: productA2.id, quantity: 1 }])
      const token = 'quote-expired-test-0123456789abcdefghijkl'
      const hash = await quoteHash(token)
      await asService(() =>
        client.query(
          `select * from public.api_send_quote($1, $2, $3, 1, $4, now() + interval '7 days')`,
          [orgA.id, USER_A, created.quote_id, hash],
        ),
      )
      await client.query(
        `update public.quotes
            set created_at = now() - interval '10 days',
                valid_until = now() - interval '1 day'
          where id = $1`,
        [created.quote_id],
      )
      const expired = await asService(() =>
        client.query(`select * from public.api_accept_quote($1, $2, 'agent')`, [
          hash,
          crypto.randomUUID(),
        ]),
      )
      assert(expired.rows[0].error_code === 'quote_expired', 'aceite expirado')
      assert(expired.rows[0].order_id === null, 'expirado criou pedido')
      const state = await client.query(
        `select status from public.quotes where id = $1`,
        [created.quote_id],
      )
      assert(state.rows[0].status === 'expired', `status ${state.rows[0].status}`)
    })

    await test('preço alterado ou produto inativo exige revisão, sem pedido', async () => {
      const assignment = await client.query(
        `select price_list_id from public.customer_price_list_assignments
          where organization_id = $1 and customer_id = $2`,
        [orgA.id, customerA.id],
      )
      const priceListId = assignment.rows[0].price_list_id

      const staleQuote = await createQuote([{ product_id: productA1.id, quantity: 1 }])
      const staleToken = 'quote-stale-test-0123456789abcdefghijklm'
      const staleHash = await quoteHash(staleToken)
      await asService(() =>
        client.query(
          `select * from public.api_send_quote($1, $2, $3, 1, $4, now() + interval '7 days')`,
          [orgA.id, USER_A, staleQuote.quote_id, staleHash],
        ),
      )
      await client.query(
        `update public.price_list_items set price_cents = 1100
          where organization_id = $1 and price_list_id = $2 and product_id = $3`,
        [orgA.id, priceListId, productA1.id],
      )
      const stale = await asService(() =>
        client.query(`select * from public.api_accept_quote($1, $2, 'agent')`, [
          staleHash,
          crypto.randomUUID(),
        ]),
      )
      assert(stale.rows[0].error_code === 'quote_stale', 'preço alterado')
      assert(stale.rows[0].order_id === null, 'preço alterado criou pedido')
      const staleState = await client.query(
        `select status from public.quotes where id = $1`,
        [staleQuote.quote_id],
      )
      assert(staleState.rows[0].status === 'expired', 'quote stale não expirou')
      const review = await client.query(
        `select event, metadata from public.quote_events
          where quote_id = $1 and event = 'review_required'`,
        [staleQuote.quote_id],
      )
      assert(review.rows.length === 1, 'evento de revisão ausente')
      await client.query(
        `update public.price_list_items set price_cents = 1000
          where organization_id = $1 and price_list_id = $2 and product_id = $3`,
        [orgA.id, priceListId, productA1.id],
      )

      const inactiveQuote = await createQuote([{ product_id: productA2.id, quantity: 1 }])
      const inactiveToken = 'quote-inactive-test-0123456789abcdefghij'
      const inactiveHash = await quoteHash(inactiveToken)
      await asService(() =>
        client.query(
          `select * from public.api_send_quote($1, $2, $3, 1, $4, now() + interval '7 days')`,
          [orgA.id, USER_A, inactiveQuote.quote_id, inactiveHash],
        ),
      )
      await client.query(`update public.products set active = false where id = $1`, [
        productA2.id,
      ])
      const inactive = await asService(() =>
        client.query(`select * from public.api_accept_quote($1, $2, 'agent')`, [
          inactiveHash,
          crypto.randomUUID(),
        ]),
      )
      assert(inactive.rows[0].error_code === 'quote_product_inactive', 'produto inativo')
      assert(inactive.rows[0].order_id === null, 'produto inativo criou pedido')
      await client.query(`update public.products set active = true where id = $1`, [
        productA2.id,
      ])
    })

    await test('orçamento pode ser recusado ou cancelado sem criar pedido', async () => {
      const declinedQuote = await createQuote([{ product_id: productA2.id, quantity: 1 }])
      const declineToken = 'quote-decline-test-0123456789abcdefghijk'
      const declineHash = await quoteHash(declineToken)
      await asService(() =>
        client.query(
          `select * from public.api_send_quote($1, $2, $3, 1, $4, now() + interval '7 days')`,
          [orgA.id, USER_A, declinedQuote.quote_id, declineHash],
        ),
      )
      const declined = await asService(() =>
        client.query(`select * from public.api_decline_quote($1, 'agent')`, [declineHash]),
      )
      assert(declined.rows[0].status === 'declined', 'status recusado')
      const replay = await asService(() =>
        client.query(`select * from public.api_decline_quote($1, 'agent')`, [declineHash]),
      )
      assert(replay.rows[0].status === 'declined', 'recusa não idempotente')
      const orders = await client.query(
        `select count(*)::integer as total from public.orders where quote_id = $1`,
        [declinedQuote.quote_id],
      )
      assert(orders.rows[0].total === 0, 'recusa criou pedido')

      const canceledQuote = await createQuote([{ product_id: productA2.id, quantity: 1 }])
      const canceled = await asService(() =>
        client.query(`select * from public.api_cancel_quote($1, $2, $3, 1)`, [
          orgA.id,
          USER_A,
          canceledQuote.quote_id,
        ]),
      )
      assert(canceled.rows[0].status === 'canceled', 'status cancelado')
    })

    await test('orçamento é Profissional, RLS isola e RPC não é exposta', async () => {
      const isolated = await asUser(USER_B, () =>
        client.query('select id from public.quotes where organization_id = $1', [orgA.id]),
      )
      assert(isolated.rows.length === 0, 'B não deveria ver orçamentos de A')
      const own = await asUser(USER_A, () =>
        client.query('select id from public.quotes where organization_id = $1 limit 1', [orgA.id]),
      )
      assert(own.rows.length === 1, 'A deveria ver o próprio orçamento')

      await client.query(
        `update public.subscriptions
            set plan_code = 'essential', plan_version = 1, state = 'active',
                current_period_end = now() + interval '30 days'
          where organization_id = $1`,
        [orgA.id],
      )
      await expectError(
        () =>
          asService(() =>
            client.query(
              `select * from public.api_create_quote($1, $2, $3, $4::jsonb, now() + interval '7 days', null)`,
              [
                orgA.id,
                USER_A,
                customerA.id,
                JSON.stringify([{ product_id: productA2.id, quantity: 1 }]),
              ],
            ),
          ),
        'plan_required',
        'Essencial criando orçamento',
      )

      const grant = await client.query(`
        select
          has_function_privilege('authenticated', 'app.accept_quote(text,uuid,text)', 'EXECUTE') as accept,
          has_function_privilege('authenticated', 'public.api_create_quote(uuid,uuid,uuid,jsonb,timestamptz,text)', 'EXECUTE') as create
      `)
      assert(grant.rows[0].accept === false, 'app.accept_quote exposto')
      assert(grant.rows[0].create === false, 'api_create_quote exposto')

      await expectError(
        () =>
          asService(() =>
            client.query(`select * from public.api_accept_quote($1, $2, null)`, [
              'f'.repeat(64),
              crypto.randomUUID(),
            ]),
          ),
        'quote_link_unavailable',
        'token inválido',
      )
    })


    console.log('[10/10] WhatsApp: opt-in e outbox desligado')

    await test('opt-in grava outbox bloqueado e é idempotente por evento', async () => {
      const requestId = crypto.randomUUID()
      const created = await asService(() =>
        client.query(
          `select * from public.api_submit_order($1, $2, $3, '', $4::jsonb, $5, $6, $7, $8)`,
          [
            orgA.slug,
            'Padaria Pão Bom',
            '11977776666',
            JSON.stringify([{ product_id: productA2.id, quantity: 1 }]),
            `wa:${requestId}`,
            requestId,
            null,
            true,
          ],
        ),
      )
      const orderId = created.rows[0].order_id
      const order = await client.query(
        `select whatsapp_opt_in, whatsapp_opt_in_at from public.orders where id = $1`,
        [orderId],
      )
      assert(order.rows[0].whatsapp_opt_in === true, 'opt-in não gravado')
      assert(order.rows[0].whatsapp_opt_in_at !== null, 'timestamp do opt-in')
      const outbox = await client.query(
        `select event, status, blocked_reason from public.whatsapp_outbox
          where order_id = $1 order by event`,
        [orderId],
      )
      assert(outbox.rows.length === 1, `outbox ${outbox.rows.length}`)
      assert(outbox.rows[0].event === 'new', 'evento new')
      assert(outbox.rows[0].status === 'blocked', 'deveria estar bloqueado')
      assert(
        outbox.rows[0].blocked_reason === 'connection_not_ready',
        `motivo ${outbox.rows[0].blocked_reason}`,
      )

      await client.query(`update public.orders set status = 'confirmed' where id = $1`, [orderId])
      await client.query(`update public.orders set status = 'completed' where id = $1`, [orderId])
      const after = await client.query(
        `select event, count(*)::integer as total from public.whatsapp_outbox
          where order_id = $1 group by event order by event`,
        [orderId],
      )
      assert(after.rows.length === 3, `eventos ${after.rows.length}`)
      assert(after.rows.every((row) => row.total === 1), 'outbox duplicada')
    })

    await test('outbox fica pendente com conexão e template aprovados, sem envio', async () => {
      await client.query(
        `insert into public.whatsapp_connections
           (organization_id, waba_id, phone_number_id, status)
         values ($1, 'waba-test', 'phone-test', 'connected')
         on conflict (organization_id) do update
           set status = 'connected', waba_id = 'waba-test', phone_number_id = 'phone-test'`,
        [orgA.id],
      )
      await client.query(
        `insert into public.whatsapp_templates
           (organization_id, event, template_name, language, status)
         values ($1, 'new', 'pedido_novo', 'pt_BR', 'approved')
         on conflict (organization_id, event, language) do update set status = 'approved'`,
        [orgA.id],
      )
      const requestId = crypto.randomUUID()
      const created = await asService(() =>
        client.query(
          `select * from public.api_submit_order($1, $2, $3, '', $4::jsonb, $5, $6, $7, $8)`,
          [
            orgA.slug,
            'Padaria Pão Bom',
            '11977776666',
            JSON.stringify([{ product_id: productA2.id, quantity: 1 }]),
            `wa-ready:${requestId}`,
            requestId,
            null,
            true,
          ],
        ),
      )
      const outbox = await client.query(
        `select status, template_id from public.whatsapp_outbox where order_id = $1`,
        [created.rows[0].order_id],
      )
      assert(outbox.rows[0].status === 'pending', `status ${outbox.rows[0].status}`)
      assert(outbox.rows[0].template_id !== null, 'template não vinculado')
      const sent = await client.query(
        `select count(*)::integer as total from public.whatsapp_outbox
          where order_id = $1 and status = 'sent'`,
        [created.rows[0].order_id],
      )
      assert(sent.rows[0].total === 0, 'outbox não pode enviar sem worker')
    })

    await test('WhatsApp exige opt-in, RLS isola e escrita é restrita', async () => {
      const requestId = crypto.randomUUID()
      const created = await asService(() =>
        client.query(
          `select * from public.api_submit_order($1, $2, $3, '', $4::jsonb, $5, $6, $7, $8)`,
          [
            orgA.slug,
            'Padaria Pão Bom',
            '11977776666',
            JSON.stringify([{ product_id: productA2.id, quantity: 1 }]),
            `wa-no:${requestId}`,
            requestId,
            null,
            false,
          ],
        ),
      )
      const outbox = await client.query(
        `select count(*)::integer as total from public.whatsapp_outbox where order_id = $1`,
        [created.rows[0].order_id],
      )
      assert(outbox.rows[0].total === 0, 'opt-in falso gerou outbox')

      const isolated = await asUser(USER_B, () =>
        client.query('select id from public.whatsapp_connections where organization_id = $1', [
          orgA.id,
        ]),
      )
      assert(isolated.rows.length === 0, 'B viu conexão de A')
      const own = await asUser(USER_A, () =>
        client.query('select id from public.whatsapp_connections where organization_id = $1', [
          orgA.id,
        ]),
      )
      assert(own.rows.length === 1, 'A não viu a própria conexão')
      await expectError(
        () =>
          asUser(USER_A, () =>
            client.query(
              `insert into public.whatsapp_connections
                 (organization_id, waba_id, phone_number_id)
               values ($1, 'x', 'y')`,
              [orgA.id],
            ),
          ),
        'permission denied',
        'browser escrevendo conexão',
      )
    })


    console.log('[11/11] Equipe, RBAC e convites manuais')

    await test('owner tem membership e papéis respeitam a matriz RLS', async () => {
      await client.query(`
        insert into auth.users (id, email, email_confirmed_at) values
          ('${USER_G}', 'manager@example.test', now()),
          ('${USER_H}', 'operator@example.test', now()),
          ('${USER_I}', 'viewer@example.test', now()),
          ('${USER_J}', 'invitee@example.test', now()),
          ('${USER_K}', 'team-owner@example.test', now())
        on conflict (id) do update set email = excluded.email, email_confirmed_at = excluded.email_confirmed_at
      `)
      const ownerMembership = await client.query(
        `select role, status from public.organization_memberships
          where organization_id = $1 and user_id = $2`,
        [orgA.id, USER_A],
      )
      assert(ownerMembership.rows[0]?.role === 'owner', 'membership owner ausente')

      await client.query(`
        insert into public.organization_memberships
          (organization_id, user_id, email, role, status)
        values
          ('${orgA.id}', '${USER_G}', 'manager@example.test', 'manager', 'active'),
          ('${orgA.id}', '${USER_H}', 'operator@example.test', 'operator', 'active'),
          ('${orgB.id}', '${USER_I}', 'viewer@example.test', 'viewer', 'active')
        on conflict (organization_id, user_id) do nothing
      `)

      const managerProducts = await asUser(USER_G, () =>
        client.query('select id from public.products where organization_id = $1', [orgA.id]),
      )
      assert(managerProducts.rows.length >= 2, 'manager não leu catálogo')
      const managerProduct = await asUser(USER_G, () => insertProduct(orgA.id, 'Produto Manager', 700))
      assert(managerProduct.id, 'manager não criou produto')

      await expectError(
        () => asUser(USER_H, () => insertProduct(orgA.id, 'Produto Operator', 700)),
        'row-level security',
        'operator criando produto',
      )
      const order = await client.query(
        `select id from public.orders where organization_id = $1 order by created_at desc limit 1`,
        [orgA.id],
      )
      await asUser(USER_H, () =>
        client.query(`update public.orders set status = 'confirmed' where id = $1`, [order.rows[0].id]),
      )

      const viewerProducts = await asUser(USER_I, () =>
        client.query('select id from public.products where organization_id = $1', [orgB.id]),
      )
      assert(viewerProducts.rows.length >= 1, 'viewer não leu catálogo')
      await expectError(
        () => asUser(USER_I, () => insertProduct(orgB.id, 'Produto Viewer', 700)),
        'row-level security',
        'viewer criando produto',
      )
      const viewerBilling = await asUser(USER_I, () =>
        client.query('select id from public.subscriptions where organization_id = $1', [orgB.id]),
      )
      assert(viewerBilling.rows.length === 0, 'viewer leu billing')
      const managerBilling = await asUser(USER_G, () =>
        client.query('select id from public.subscriptions where organization_id = $1', [orgA.id]),
      )
      assert(managerBilling.rows.length === 1, 'manager deveria ler status da assinatura')

      await expectError(
        () =>
          client.query(
            `update public.organization_memberships set role = 'manager'
              where organization_id = $1 and user_id = $2`,
            [orgA.id, USER_A],
          ),
        'owner_membership_protected',
        'rebaixar owner',
      )
    })

    await test('convite exige e-mail verificado, é único e aceita uma vez', async () => {
      const teamOrg = await createOrg(USER_K, 'Equipe Teste', '11955554444')
      await client.query(`
        insert into public.subscriptions
          (organization_id, state, current_period_end, plan_code, plan_version)
        values ('${teamOrg.id}', 'active', now() + interval '20 days', 'professional', 1)
        on conflict (organization_id) do update
          set state = 'active', current_period_end = now() + interval '20 days',
              plan_code = 'professional', plan_version = 1
      `)
      const token = 'team-invite-token-0123456789abcdefghijk'
      const hash = await quoteHash(token)
      const created = await asService(() =>
        client.query(
          `select * from public.api_create_invitation($1, $2, $3, $4, $5, now() + interval '7 days')`,
          [teamOrg.id, USER_K, 'invitee@example.test', 'operator', hash],
        ),
      )
      assert(created.rows[0].invitation_id, 'convite não criado')

      const accepted = await asService(() =>
        client.query(`select * from public.api_accept_invitation($1, $2)`, [hash, USER_J]),
      )
      assert(accepted.rows[0].organization_id === teamOrg.id, 'org do convite')
      assert(accepted.rows[0].role === 'operator', 'papel do convite')
      await expectError(
        () =>
          asService(() =>
            client.query(`select * from public.api_accept_invitation($1, $2)`, [hash, USER_J]),
          ),
        'invitation_unavailable',
        'replay do convite',
      )

      const membership = await client.query(
        `select id from public.organization_memberships
          where organization_id = $1 and user_id = $2`,
        [teamOrg.id, USER_J],
      )
      await asService(() =>
        client.query(`select * from public.api_change_member_role($1, $2, $3, 'viewer')`, [
          teamOrg.id,
          USER_K,
          membership.rows[0].id,
        ]),
      )
      await expectError(
        () =>
          asUser(USER_J, () =>
            client.query(
              `insert into public.customers (organization_id, display_name, contact_phone)
               values ($1, 'Cliente Viewer', '11933332222')`,
              [teamOrg.id],
            ),
          ),
        'row-level security',
        'viewer criando cliente',
      )
      await asService(() =>
        client.query(`select * from public.api_revoke_member($1, $2, $3)`, [
          teamOrg.id,
          USER_K,
          membership.rows[0].id,
        ]),
      )
      const afterRevoke = await asUser(USER_J, () =>
        client.query('select id from public.organizations where id = $1', [teamOrg.id]),
      )
      assert(afterRevoke.rows.length === 0, 'membro revogado ainda lê a organização')
    })

    await test('convite expirado, e-mail divergente e limite de equipe são bloqueados', async () => {
      const teamOrg = await client.query(
        `select id from public.organizations where owner_user_id = $1 limit 1`,
        [USER_K],
      )
      const orgId = teamOrg.rows[0].id
      const expiredToken = 'team-expired-token-0123456789abcdefghij'
      const expiredHash = await quoteHash(expiredToken)
      await client.query(
        `insert into public.organization_invitations
           (organization_id, email, role, token_hash, expires_at, invited_by, created_at)
         values ($1, 'invitee@example.test', 'operator', $2, now() - interval '1 day', $3, now() - interval '2 days')`,
        [orgId, expiredHash, USER_K],
      )
      await expectError(
        () =>
          asService(() =>
            client.query(`select * from public.api_accept_invitation($1, $2)`, [expiredHash, USER_J]),
          ),
        'invitation_unavailable',
        'convite expirado',
      )

      const otherToken = 'team-other-token-0123456789abcdefghijkl'
      const otherHash = await quoteHash(otherToken)
      await asService(() =>
        client.query(
          `select * from public.api_create_invitation($1, $2, $3, $4, $5, now() + interval '7 days')`,
          [orgId, USER_K, 'other@example.test', 'viewer', otherHash],
        ),
      )
      await expectError(
        () =>
          asService(() =>
            client.query(`select * from public.api_accept_invitation($1, $2)`, [otherHash, USER_J]),
          ),
        'invitation_email_mismatch',
        'e-mail divergente',
      )

      const secondHash = await quoteHash('team-limit-second')
      await asService(() =>
        client.query(
          `select * from public.api_create_invitation($1, $2, $3, 'viewer', $4, now() + interval '7 days')`,
          [orgId, USER_K, 'second@example.test', secondHash],
        ),
      )
      const fourthHash = await quoteHash('team-limit-fourth')
      await expectError(
        () =>
          asService(() =>
            client.query(
              `select * from public.api_create_invitation($1, $2, 'fourth@example.test', 'viewer', $3, now() + interval '7 days')`,
              [orgId, USER_K, fourthHash],
            ),
          ),
        'team_limit_reached',
        'limite de equipe',
      )
    })


    console.log('[12/12] Radar de recompra')

    await test('radar calcula mediana, ignora cancelados e sinaliza atraso', async () => {
      await client.query(
        `update public.subscriptions
            set plan_code = 'professional', plan_version = 1, state = 'active',
                current_period_end = now() + interval '30 days'
          where organization_id = $1`,
        [orgA.id],
      )
      const radarCustomer = await asUser(USER_A, () =>
        insertCustomer(orgA.id, 'Radar Cliente', '11944443333'),
      )
      const radarShort = await asUser(USER_A, () =>
        insertCustomer(orgA.id, 'Radar Curto', '11944442222'),
      )
      const insertOrder = async (customerId, daysAgo, status, suffix) => {
        await client.query(
          `insert into public.orders
             (organization_id, customer_id, public_reference, status, total_cents, source, created_at)
           values ($1, $2, $3, $4, 1000, 'manual', now() - ($5 || ' days')::interval)`,
          [orgA.id, customerId, `PD-RADAR-${suffix}-${crypto.randomUUID().slice(0, 8)}`, status, daysAgo],
        )
      }
      await insertOrder(radarCustomer.id, 50, 'completed', 'a')
      await insertOrder(radarCustomer.id, 40, 'completed', 'b')
      await insertOrder(radarCustomer.id, 30, 'completed', 'c')
      await insertOrder(radarCustomer.id, 20, 'completed', 'd')
      await insertOrder(radarCustomer.id, 5, 'canceled', 'e')
      await insertOrder(radarShort.id, 20, 'completed', 'f')
      await insertOrder(radarShort.id, 10, 'completed', 'g')

      const radar = await asUser(USER_A, () =>
        client.query(
          `select * from public.api_reorder_radar($1, 'Radar', 50, 0)`,
          [orgA.id],
        ),
      )
      const late = radar.rows.find((row) => row.customer_id === radarCustomer.id)
      const short = radar.rows.find((row) => row.customer_id === radarShort.id)
      assert(late, 'cliente atrasado ausente')
      assert(late.valid_order_count === 4, `pedidos ${late.valid_order_count}`)
      assert(Number(late.median_interval_days) === 10, `mediana ${late.median_interval_days}`)
      assert(late.overdue === true, 'deveria estar atrasado')
      assert(short.insufficient === true, 'histórico curto deveria ser insuficiente')
      assert(short.median_interval_days === null, 'não pode inventar mediana')
      assert(radar.rows[0].total_count >= 2, 'total_count')

      await asUser(USER_A, () =>
        client.query(
          `update public.customers set reorder_snoozed_until = now() + interval '30 days'
            where id = $1`,
          [radarCustomer.id],
        ),
      )
      const snoozed = await asUser(USER_A, () =>
        client.query(
          `select * from public.api_reorder_radar($1, 'Radar Cliente', 50, 0)`,
          [orgA.id],
        ),
      )
      assert(snoozed.rows[0].overdue === false, 'soneca não silenciou')
      await expectError(
        () =>
          asUser(USER_B, () =>
            client.query(`select * from public.api_reorder_radar($1, null, 50, 0)`, [orgA.id]),
          ),
        'forbidden',
        'B acessando radar de A',
      )
    })


    await test('lembretes são isolados por tenant e exigem histórico válido', async () => {
      const reminder = await client.query(
        `insert into public.reorder_reminders
           (organization_id, customer_id, cycle_key, message, status)
         values ($1, $2, 'db-cycle-1', 'Lembrete de teste', 'suggested')
         returning id`,
        [orgA.id, customerA.id],
      )
      assert(reminder.rows[0].id, 'lembrete não criado')
      const isolated = await asUser(USER_B, () =>
        client.query('select id from public.reorder_reminders where organization_id = $1', [orgA.id]),
      )
      assert(isolated.rows.length === 0, 'B viu lembrete de A')
      const own = await asUser(USER_A, () =>
        client.query('select id from public.reorder_reminders where organization_id = $1', [orgA.id]),
      )
      assert(own.rows.length >= 1, 'A não viu o próprio lembrete')
      await expectError(
        () =>
          client.query(
            `insert into public.reorder_reminders
               (organization_id, customer_id, cycle_key, message)
             values ($1, $2, 'db-cycle-1', 'Duplicado')`,
            [orgA.id, customerA.id],
          ),
        'reorder_reminders_unique',
        'lembrete duplicado',
      )
    })

    console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`)
    if (failed > 0) {
      for (const { name, error } of failures) {
        console.error(`  - ${name}: ${error.stack ?? error.message}`)
      }
      process.exitCode = 1
    }
  } finally {
    if (client) await client.end().catch(() => {})
    docker(['rm', '-f', CONTAINER], { allowFailure: true })
  }
}

main().catch((error) => {
  console.error(error)
  docker(['rm', '-f', CONTAINER], { allowFailure: true })
  process.exit(1)
})
