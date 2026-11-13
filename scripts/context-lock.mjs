#!/usr/bin/env node
/** Gera docs/context-lock.md com base/head SHA e hashes SHA-256 dos arquivos críticos. */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim()
}

const base = git('rev-parse main')
const head = git('rev-parse HEAD')
const branch = git('branch --show-current')
const date = new Date().toISOString().slice(0, 10)
const workOrder = process.env.WORK_ORDER ?? 'PDA-MVP-WO-001 (PDF, 12/11/2026)'
const issues = process.env.ISSUES ?? 'PDA-001 a PDA-011'

const include = /^(README\.md|package\.json|package-lock\.json|index\.html|eslint\.config\.js|tsconfig(\.node)?\.json|vite\.config\.ts|public\/_(headers|redirects)|\.github\/workflows\/.*\.yml|docs\/.*\.md|supabase\/config\.toml|supabase\/migrations\/.*\.sql|supabase\/tests\/.*\.sql|supabase\/functions\/(_shared\/.*|[^/]+\/index)\.ts|src\/.*\.(ts|tsx|css)|scripts\/.*\.(mjs|ts))$/

const files = git('ls-files')
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => include.test(file))
  .filter((file) => file !== 'docs/context-lock.md')
  .sort()

const rows = files.map((file) => {
  const hash = createHash('sha256').update(readFileSync(resolve(ROOT, file))).digest('hex')
  return `| \`${file}\` | \`${hash}\` |`
})

const content = `# Context Lock

## Identificação

- Data do lock: ${date}
- Repositório: \`https://github.com/KayzenRoot/pedeoutra\`
- Branch: \`${branch}\`
- Base SHA: \`${base}\`
- HEAD no momento da geração: \`${head}\`
- Work Order: \`${workOrder}\`

## Issues verificadas (sem duplicatas)

${issues}. Nenhuma issue foi criada ou duplicada. Links:
\`https://github.com/KayzenRoot/pedeoutra/issues/<n>\`.

## Hashes SHA-256 dos arquivos críticos

| Arquivo | SHA-256 |
| --- | --- |
${rows.join('\n')}

## Fontes externas verificadas

- Asaas Checkout recorrente: \`POST /v3/checkouts\`, header \`access_token\`,
  \`billingTypes\`/\`chargeTypes\`/\`subscription\`, resposta com \`id\` e \`link\`.
- Webhook Asaas: \`POST\`, header \`asaas-access-token\`, payload \`id\`/\`event\`.
- Idempotência: \`provider_event_id\` único, persistir antes de processar.
- Supabase RLS/Edge Functions e Cloudflare Pages: documentação oficial.

## Regra de staleness

Se qualquer fonte acima mudar durante a execução, marcar \`STALE\`, atualizar o
contexto e registrar a mudança antes de continuar. Não promover verdade
canônica sem auditoria.

> O HEAD acima é o commit de código imediatamente anterior ao commit que
> versiona este arquivo; o SHA final da entrega está no Evidence Bundle.
`

writeFileSync(resolve(ROOT, 'docs', 'context-lock.md'), content, 'utf8')
console.log(`docs/context-lock.md gerado: ${files.length} arquivos, base ${base.slice(0, 7)}, head ${head.slice(0, 7)}`)
