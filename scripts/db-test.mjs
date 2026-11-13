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
  email text
);
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

    console.log('\n[1/7] Bootstrap e migrations')
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

    console.log('\n[2/7] Seed sintético e criação de organizações')
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

    console.log('\n[3/7] RLS A/B')
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

    console.log('\n[4/7] Trial, assinatura e escrita')
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

    console.log('\n[5/7] Pedido público, recompra, rate limit e idempotência')
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

    console.log('\n[6/7] Status do pedido e billing')
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

    console.log('\n[7/7] Planos, entitlements, trial e admin')

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
      const results = []
      for (let index = 0; index < 4; index += 1) {
        const row = await asService(() =>
          client.query(`select app.consume_quota($1, 'db_test_quota', 3, 60) as allowed`, [
            orgB.id,
          ]),
        )
        results.push(row.rows[0].allowed)
      }
      assert(
        JSON.stringify(results) === JSON.stringify([true, true, true, false]),
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
