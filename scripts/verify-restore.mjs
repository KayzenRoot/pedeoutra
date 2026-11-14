#!/usr/bin/env node
/**
 * Verifica recuperação de schema/dados sintéticos:
 * 1. sobe Postgres isolado;
 * 2. aplica bootstrap + migrations;
 * 3. insere dados fictícios;
 * 4. faz pg_dump;
 * 5. restaura em outro banco;
 * 6. compara contagens e checksums.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const BOOTSTRAP = join(ROOT, 'supabase', 'tests', '00_bootstrap.sql')
const CONTAINER = `pedeoutra-restore-${process.pid}`
const SOURCE_DB = 'pedeoutra_restore_source'
const TARGET_DB = 'pedeoutra_restore_target'
const IMAGE = 'postgres:17-alpine'

const SYNTHETIC_SQL = `
insert into auth.users (id, email)
values ('aaaaaaaa-1111-4111-8111-111111111111', 'restore@example.test');

insert into public.organizations (id, owner_user_id, name, slug, whatsapp, city)
values (
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-1111-4111-8111-111111111111',
  'Distribuidora Restore', 'distribuidora-restore-abc123', '11999998888', 'São Paulo'
);

insert into public.products (id, organization_id, name, unit, price_cents)
values (
  'aaaaaaaa-3333-4333-8333-333333333333',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'Copo 200ml', 'cento', 1250
);

insert into public.customers (id, organization_id, display_name, contact_phone)
values (
  'aaaaaaaa-4444-4444-8444-444444444444',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'Padaria Restore', '11977776666'
);

insert into public.orders (
  id, organization_id, customer_id, public_reference, status, total_cents,
  buyer_name, buyer_phone, note, source
) values (
  'aaaaaaaa-5555-4555-8555-555555555555',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-4444-4444-8444-444444444444',
  'PD-RESTORE001', 'new', 2500, 'Padaria Restore', '11977776666', 'Teste de restore', 'catalog'
);

insert into public.order_items (
  id, organization_id, order_id, product_id, name_snapshot, unit_snapshot,
  unit_price_cents, quantity, subtotal_cents
) values (
  'aaaaaaaa-6666-4666-8666-666666666666',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-5555-4555-8555-555555555555',
  'aaaaaaaa-3333-4333-8333-333333333333',
  'Copo 200ml', 'cento', 1250, 2, 2500
);

insert into public.reorder_links (
  id, organization_id, customer_id, token_hash, template_json, expires_at, created_by
) values (
  'aaaaaaaa-7777-4777-8777-777777777777',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-4444-4444-8444-444444444444',
  repeat('a', 64),
  '[{"product_id":"aaaaaaaa-3333-4333-8333-333333333333","quantity":2}]'::jsonb,
  now() + interval '60 days',
  'aaaaaaaa-1111-4111-8111-111111111111'
);

insert into public.subscriptions (
  id, organization_id, provider, provider_customer_id, provider_subscription_id,
  provider_checkout_id, state, current_period_end
) values (
  'aaaaaaaa-8888-4888-8888-888888888888',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'asaas', 'cus_restore', 'sub_restore', 'chk_restore', 'active', now() + interval '30 days'
);

insert into public.billing_events (
  id, provider_event_id, event_type, payload_minimal, state
) values (
  'aaaaaaaa-9999-4999-8999-999999999999',
  'evt_restore_001',
  'PAYMENT_RECEIVED',
  '{"id":"evt_restore_001","type":"PAYMENT_RECEIVED","valueCents":2990}'::jsonb,
  'processed'
);

insert into public.audit_events (organization_id, action, entity)
values ('aaaaaaaa-2222-4222-8222-222222222222', 'restore.seeded', 'database');

insert into public.rate_limits (bucket, window_started_at, counter)
values ('restore:bucket:0000000000000000000000000000000000000000000000000000000000000000', now(), 1);

insert into public.product_categories (id, organization_id, name, slug, position)
values (
  'aaaaaaaa-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-2222-4222-8222-222222222222', 'Bebidas', 'bebidas', 1
);

insert into public.product_images (
  id, organization_id, product_id, storage_path, alt_text, is_cover
) values (
  'aaaaaaaa-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-3333-4333-8333-333333333333',
  'aaaaaaaa-2222-4222-8222-222222222222/aaaaaaaa-3333-4333-8333-333333333333/aaaaaaaa-dddd-4ddd-8ddd-dddddddddddd.jpg',
  'Copo de água', true
);

insert into public.price_lists (id, organization_id, name)
values (
  'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-2222-4222-8222-222222222222', 'Tabela Restore'
);

insert into public.price_list_items (
  id, organization_id, price_list_id, product_id, price_cents
) values (
  'aaaaaaaa-ffff-4fff-8fff-ffffffffffff',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-3333-4333-8333-333333333333', 1000
);

insert into public.customer_price_list_assignments (
  id, organization_id, customer_id, price_list_id
) values (
  'aaaaaaaa-1111-4111-8111-222222222222',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-4444-4444-8444-444444444444',
  'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeee'
);

insert into public.customer_price_tokens (
  id, organization_id, customer_id, token_hash, expires_at, created_by
) values (
  'aaaaaaaa-1111-4111-8111-333333333333',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-4444-4444-8444-444444444444',
  repeat('b', 64), now() + interval '30 days',
  'aaaaaaaa-1111-4111-8111-111111111111'
);

insert into public.quotes (
  id, organization_id, customer_id, public_reference, status, version,
  valid_until, notes, price_source, total_cents, created_by
) values (
  'aaaaaaaa-1111-4111-8111-444444444444',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-4444-4444-8444-444444444444',
  'OR-RESTORE1', 'sent', 2, now() + interval '7 days',
  'Proposta de restore', 'public', 2500,
  'aaaaaaaa-1111-4111-8111-111111111111'
);

insert into public.quote_items (
  id, organization_id, quote_id, product_id, name_snapshot, unit_snapshot,
  quantity, unit_price_cents, subtotal_cents, price_source
) values (
  'aaaaaaaa-1111-4111-8111-555555555555',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-1111-4111-8111-444444444444',
  'aaaaaaaa-3333-4333-8333-333333333333',
  'Copo 200ml', 'cento', 2, 1250, 2500, 'public'
);

insert into public.quote_events (
  id, organization_id, quote_id, actor_user_id, event, to_status, metadata
) values (
  'aaaaaaaa-1111-4111-8111-666666666666',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-1111-4111-8111-444444444444',
  'aaaaaaaa-1111-4111-8111-111111111111',
  'sent', 'sent', '{"expires_at":"2026-12-01T00:00:00Z"}'::jsonb
);

insert into public.quote_links (
  id, organization_id, quote_id, token_hash, expires_at, created_by
) values (
  'aaaaaaaa-1111-4111-8111-777777777777',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-1111-4111-8111-444444444444',
  repeat('c', 64), now() + interval '7 days',
  'aaaaaaaa-1111-4111-8111-111111111111'
);

insert into public.platform_admins (singleton, user_id)
values (true, 'aaaaaaaa-1111-4111-8111-111111111111');

insert into public.trial_grants (
  id, organization_id, user_id, granted_at, ends_at, status, risk_score
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'aaaaaaaa-1111-4111-8111-111111111111',
  now() - interval '1 day', now() + interval '6 days', 'granted', 25
);

insert into public.trial_signals (signal_type, signal_hash, organization_id, user_id)
values
  ('email', app.hash_trial_signal('email', 'restore@example.test'),
   'aaaaaaaa-2222-4222-8222-222222222222', 'aaaaaaaa-1111-4111-8111-111111111111'),
  ('phone', app.hash_trial_signal('phone', '11999998888'),
   'aaaaaaaa-2222-4222-8222-222222222222', 'aaaaaaaa-1111-4111-8111-111111111111');

insert into public.plan_changes (
  id, organization_id, from_plan_code, to_plan_code, status, requested_by, reason
) values (
  'aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-2222-4222-8222-222222222222',
  'essential', 'professional', 'blocked',
  'aaaaaaaa-1111-4111-8111-111111111111', 'restore seed'
);

insert into public.quota_usage (organization_id, quota_key, window_start, window_seconds, used)
values (
  'aaaaaaaa-2222-4222-8222-222222222222', 'restore_quota',
  date_trunc('minute', now()), 60, 1
);

insert into public.platform_audit_events (
  actor_user_id, action, target_organization_id, reason, status
) values (
  'aaaaaaaa-1111-4111-8111-111111111111', 'admin.restore',
  'aaaaaaaa-2222-4222-8222-222222222222', 'restore seed', 'ok'
);
`

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

function psql(database, sql) {
  const result = docker([
    'exec', CONTAINER,
    'psql', '-U', 'postgres', '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql,
  ])
  return result.stdout.trim()
}

async function applyFile(database, path) {
  const sql = readFileSync(path, 'utf8')
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      [
        'exec', '-i', CONTAINER,
        'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1',
      ],
      { input: sql, encoding: 'utf8' },
    )
    if (result.status === 0) return
    const error = `${result.stderr}${result.stdout}`
    if (!/shutting down|starting up|connection to server|could not connect/i.test(error)) {
      throw new Error(`Falha ao aplicar ${path}: ${error}`)
    }
    await sleep(1000)
  }
  throw new Error(`Falha ao aplicar ${path}: banco não estabilizou`)
}

const CHECKSUM_SQL = `
select
  (select count(*) from public.organizations) as organizations,
  (select count(*) from public.products) as products,
  (select count(*) from public.customers) as customers,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.order_items) as order_items,
  (select count(*) from public.reorder_links) as reorder_links,
  (select count(*) from public.subscriptions) as subscriptions,
  (select count(*) from public.billing_events) as billing_events,
  (select count(*) from public.audit_events) as audit_events,
  (select count(*) from public.plan_catalog) as plan_catalog,
  (select count(*) from public.plan_feature_entitlements) as plan_features,
  (select count(*) from public.trial_grants) as trial_grants,
  (select count(*) from public.trial_signals) as trial_signals,
  (select count(*) from public.platform_admins) as platform_admins,
  (select count(*) from public.platform_audit_events) as platform_audit_events,
  (select count(*) from public.plan_changes) as plan_changes,
  (select count(*) from public.quota_usage) as quota_usage,
  (select count(*) from public.product_categories) as product_categories,
  (select count(*) from public.product_images) as product_images,
  (select count(*) from public.price_lists) as price_lists,
  (select count(*) from public.price_list_items) as price_list_items,
  (select count(*) from public.customer_price_list_assignments) as price_assignments,
  (select count(*) from public.customer_price_tokens) as price_tokens,
  (select count(*) from public.quotes) as quotes,
  (select count(*) from public.quote_items) as quote_items,
  (select count(*) from public.quote_events) as quote_events,
  (select count(*) from public.quote_links) as quote_links,
  (select md5(string_agg(id::text || ':' || public_reference || ':' || status || ':' || price_source || ':' || coalesce(price_list_id::text, ''), ',' order by id)) from public.orders) as orders_hash,
  (select md5(string_agg(name_snapshot || ':' || quantity, ',' order by id)) from public.order_items) as items_hash,
  (select md5(string_agg(plan_code || ':' || price_cents || ':' || currency, ',' order by plan_code)) from public.plan_catalog) as plans_hash,
  (select md5(string_agg(plan_code || ':' || plan_version || ':' || state, ',' order by organization_id)) from public.subscriptions) as subscriptions_hash,
  (select md5(string_agg(user_id::text || ':' || status || ':' || risk_score, ',' order by user_id)) from public.trial_grants) as trials_hash,
  (select md5(string_agg(actor_user_id::text || ':' || action, ',' order by id)) from public.platform_audit_events) as platform_audit_hash,
  (select md5(string_agg(id::text || ':' || name || ':' || slug, ',' order by id)) from public.product_categories) as categories_hash,
  (select md5(string_agg(id::text || ':' || alt_text || ':' || is_cover, ',' order by id)) from public.product_images) as images_hash,
  (select md5(string_agg(id::text || ':' || name || ':' || active, ',' order by id)) from public.price_lists) as price_lists_hash,
  (select md5(string_agg(id::text || ':' || product_id::text || ':' || price_cents, ',' order by id)) from public.price_list_items) as price_items_hash,
  (select md5(string_agg(id::text || ':' || public_reference || ':' || status || ':' || total_cents, ',' order by id)) from public.quotes) as quotes_hash,
  (select md5(string_agg(id::text || ':' || name_snapshot || ':' || subtotal_cents, ',' order by id)) from public.quote_items) as quote_items_hash
`

async function main() {
  const port = await findFreePort()
  console.log(`PedeOutra restore test — container ${CONTAINER} na porta ${port}`)

  docker([
    'run', '--rm', '-d',
    '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', `POSTGRES_DB=${SOURCE_DB}`,
    '-p', `127.0.0.1:${port}:5432`,
    IMAGE,
  ])

  try {
    let ready = false
    for (let attempt = 1; attempt <= 180; attempt += 1) {
      const result = docker(
        ['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', SOURCE_DB],
        { allowFailure: true },
      )
      if (result.status === 0) {
        ready = true
        break
      }
      await sleep(500)
    }
    if (!ready) throw new Error('Postgres não ficou pronto em 90s')

    console.log('[1/5] Bootstrap e migrations')
    await applyFile(SOURCE_DB, BOOTSTRAP)
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort()
    for (const file of migrations) {
      await applyFile(SOURCE_DB, join(MIGRATIONS_DIR, file))
      console.log(`  applied ${file}`)
    }

    console.log('[2/5] Dados sintéticos')
    const seed = spawnSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', SOURCE_DB, '-v', 'ON_ERROR_STOP=1'],
      { input: SYNTHETIC_SQL, encoding: 'utf8' },
    )
    if (seed.status !== 0) throw new Error(`Falha no seed: ${seed.stderr}`)
    console.log('  seeded')

    console.log('[3/5] pg_dump')
    docker([
      'exec', CONTAINER,
      'pg_dump', '-U', 'postgres', '-d', SOURCE_DB, '-Fc', '-f', '/tmp/pedeoutra.dump',
    ])
    console.log('  dump criado')

    console.log('[4/5] Restore em banco novo')
    docker(['exec', CONTAINER, 'createdb', '-U', 'postgres', TARGET_DB])
    const restore = docker([
      'exec', CONTAINER,
      'pg_restore', '-U', 'postgres', '-d', TARGET_DB, '/tmp/pedeoutra.dump',
    ], { allowFailure: true })
    if (restore.status !== 0) {
      throw new Error(`pg_restore falhou: ${restore.stderr || restore.stdout}`)
    }
    console.log('  restore concluído')

    console.log('[5/5] Comparação source x target')
    const source = psql(SOURCE_DB, CHECKSUM_SQL)
    const target = psql(TARGET_DB, CHECKSUM_SQL)
    if (source !== target) {
      console.error('SOURCE:', source)
      console.error('TARGET:', target)
      throw new Error('checksums divergentes após restore')
    }

    const columns = [
      'organizations',
      'products',
      'customers',
      'orders',
      'order_items',
      'reorder_links',
      'subscriptions',
      'billing_events',
      'audit_events',
      'plan_catalog',
      'plan_features',
      'trial_grants',
      'trial_signals',
      'platform_admins',
      'platform_audit_events',
      'plan_changes',
      'quota_usage',
      'product_categories',
      'product_images',
      'price_lists',
      'price_list_items',
      'price_assignments',
      'price_tokens',
      'quotes',
      'quote_items',
      'quote_events',
      'quote_links',
      'orders_hash',
      'price_lists_hash',
      'price_items_hash',
      'quotes_hash',
      'quote_items_hash',
      'items_hash',
      'plans_hash',
      'subscriptions_hash',
      'trials_hash',
      'platform_audit_hash',
      'categories_hash',
      'images_hash',
    ]
    const values = source.split('|')
    columns.forEach((name, index) => console.log(`  ${name}=${values[index]}`))

    console.log('\nPASS restore: contagens e checksums idênticos em dados sintéticos')
  } finally {
    docker(['rm', '-f', CONTAINER], { allowFailure: true })
  }
}

main().catch((error) => {
  console.error(error)
  docker(['rm', '-f', CONTAINER], { allowFailure: true })
  process.exit(1)
})
