# PedeOutra V2 — deploy de produção (2026-11-16)

Autorização: proprietário autorizou explicitamente merge/deploy do PR #90.
Escopo: Partes 2–5. Nenhuma cobrança, e-mail, WhatsApp, crédito ou compra foi
executado.

## Backup

- Dump de schema público, schema `auth` e dados antes de qualquer migration.
- Diretório local fora do repositório:
  `C:\Users\csn19\pedeoutra-secrets\backups\20261116T153458Z`.
- SHA-256 registrado em `SHA256SUMS` no mesmo diretório.
- Restauração de verificação em Postgres 17 isolado: contagens idênticas
  (`organizations=1`, `products=1`, `orders=1`, `users=1`, `subscriptions=1`,
  `platform_admins=1`).

## Migrations

- `supabase db push --linked`: **19/19 aplicadas** em ordem.
- `supabase migration list --linked`: todas as 25 migrations locais constam como
  aplicadas no remoto.
- Dados reais preservados após o push: mesmas contagens acima.
- Novas tabelas de relatório/indicações criadas vazias.

## Edge Functions

- **57 funções ACTIVE** publicadas (15 existentes atualizadas + 42 novas).
- `verify_jwt` conferido via Management API: público = `false`, autenticado =
  `true`, conforme `supabase/config.toml`.
- `admin-api` sem token responde **401**; `analytics-ingest` com payload vazio
  responde **400** (sem escrita).
- `plan-catalog` 200 com Essencial/Profissional; `public-catalog` 200 com a
  organização real e 1 produto.

## Frontend / PR

- PR #90 mergeado em `main`: merge commit `9d3298f`.
- Primeiro deploy Pages da `main`: `e842536e` (commit `9d3298f`).
- **Incidente de roteamento encontrado e corrigido:** o `_redirects` com alvo
  `/index.html 200` foi interpretado pelo Cloudflare como redirecionamento para
  `/`; `/app`, `/admin`, `/entrar` e links opacos quebraram. O alvo foi trocado
  para `/`, com PR #92 (`ff8736c`) e deploy manual `28c7fb31`.
- Deploy Git final da `main`: `11a318a2` (commit `ff8736c`).
- Verificação final na URL pública:
  - `/`, `/app`, `/app/relatorios`, `/entrar`, `/admin`, `/c/*`, `/r/*`,
    `/acompanhar/*`, `/p/*`, `/o/*`, `/convite/*` = **200**.
  - `/rota-inexistente` = **404** real.
  - `/app/relatorios` = `X-Robots-Tag: noindex, nofollow`.
  - `/demo/`, `/privacidade/`, `/setores/embalagens/` = 200.

## Admin e banco

- TOTP/AAL2 já concluído; `platform_admins` e auditoria confirmados.
- RPCs administrativas em produção: `api_admin_overview` 1 linha,
  `api_admin_health` 9 métricas, `api_admin_financial` 17 métricas,
  `api_admin_analytics` 5 eventos — todas OK via service_role.
- Relatório e indicações foram validados no clone de produção antes do deploy.

## Estado

- Partes 2–5 **deployadas** em produção.
- `COMMERCIAL_BLOCKED` permanece: SMTP, WABA/Meta, DeepSeek/Resend/Meta Ads,
  backup/PITR, legal/suporte, primeira cobrança real e aprovação financeira de
  recompensa (ADR-015 PROPOSED).
- Rollback: backup verificado + migrations aditivas + reverter merge/Pages e
  restaurar dump se necessário.
