# Checkpoint

## Base da execução

- Data: 2026-11-12/13
- Repositório: `KayzenRoot/pedeoutra` (público)
- Branch de trabalho: `feat/PDA-MVP-WO-001-pedeoutra-mvp`, mesclada em `main`
  pelo PR #12 (merge commit `26d55e0024ba47039b8e8a15d49d08c971964890`).
- Base SHA: `40990e437a455f161fd8c60f35be983f29209794`
- Estado da base: somente `README.md` inicial; 11 issues abertas (PDA-001..011).
- Credenciais usadas: GitHub, Supabase Cloud, Asaas produção/Sandbox e Cloudflare Pages.
- Docker disponível: sim; reparado com `wsl --update` + reinício do backend.

## Incrementos desta WO

1. Source Pack canônico e Context Lock.
2. Scaffold React/Vite/TS, lint, typecheck, testes e CI.
3. Schema, migrations, RLS, RPCs e testes A/B.
4. Edge Functions públicas/autenticadas e billing com mocks.
5. Landing, auth, onboarding, painel, catálogo, recompra e billing UI.
6. Suíte crítica, restore, Evidence Bundle e PR; PR #12 mesclado com
   autorização explícita.

## Resultado final

- 78 testes unitários/componente, 30 testes de banco/RLS, 13 testes HTTP via
  PostgREST, 17 testes HTTP dos handlers Deno, restore, typecheck das 11 Edge
  Functions, build e smoke de browser com axe WCAG 2 A/AA verdes.
- Harness E2E completo com GoTrue real + Asaas mock: 7 grupos PASS no CI.
- Migrations aplicadas no Supabase Cloud (`waygtbclkxklexnabwvj`).
- Frontend publicado em Cloudflare Pages: `https://pedeoutra.pages.dev`, agora
  projeto Git conectado a `KayzenRoot/pedeoutra`, produção em `main` e
  auto-deploy por push; deployment do merge `26d55e0` = `c26319e5`.
- 11 Edge Functions publicadas; secrets configurados (sem valores no repo).
- Asaas Sandbox: checkout real, pagamento de teste, webhook autenticado e
  assinatura ativada; smoke completo de produção PASS. Assinatura/cliente e
  dados sintéticos removidos em 13/11 para deixar o staging limpo.
- Docker local corrigido com `wsl --update` + reinício do backend do Docker
  Desktop; `test:db` 30/30, `test:postgrest` 13/13, `test:edge-http` 17/17,
  `test:full-local` 7/7 e `test:restore` PASS executados localmente.
- Keepalive diário do Supabase configurado em
  `.github/workflows/keepalive.yml`; ADR-007 registra East US/Ohio no staging e
  a migração para `sa-east-1` + Pro como pré-requisitos do go-live.
- Asaas produção aprovado e configurado: API key, checkout e webhook de
  produção validados com checkout de teste **sem pagamento**; webhook
  `71177108-9a90-43be-92b3-a9cf91595169` com 13 eventos. Sandbox e dados de
  teste removidos.
- Primeira cobrança real ainda não executada; depende de autorização explícita,
  domínio, Supabase Pro/região e auditoria.
- Decisão de lançamento (2026-11-13): manter `pedeoutra.pages.dev` e Supabase
  Free/Ohio com keepalive, aceitando risco de pausa/backup; nenhuma cobrança
  real de teste. Fluxo de recuperação de senha implementado; SMTP próprio
  permanece pendente de credenciais.

## Pendências

- Primeira cobrança real controlada, com autorização explícita.
- Auditoria independente; domínio próprio não é requisito desta fase.
- Decisão de backup/continuidade: ADR-009 PROPOSED recomenda Pro/Ohio antes do
  primeiro pagante; enquanto não aceita, backup de produção é BLOCKED.
- SMTP próprio pendente (SMTP_BLOCKED); canal oficial de suporte/privacidade e
  revisão jurídica pendentes.
- Monitorar `supabase-keepalive`, `billing-reconcile` e `release-health`; falha
  exige verificação manual.

## Próxima ação autorizada

PR #12 mesclado: https://github.com/KayzenRoot/pedeoutra/pull/12

CI da `main`: run 43443234172 (merge `203f91b`) — 4 jobs verdes.

O staging contém 1 usuário/organização/produto/pedido real identificado fora dos
testes; esses dados foram preservados. Os smokes removem apenas os dados
sintéticos que criam. O Asaas produção está configurado e validado sem cobrança;
SMTP, backup/continuidade, suporte/legal e a primeira cobrança real seguem como
gates de lançamento.

## Checkpoint Delta — PDA-V2-P01-WO-001 (PROPOSED)

- **Base:** PR #77 mesclada em `main` (`40b4224`, 2026-11-13) após Gate Zero
  `APPROVED STAGING / COMMERCIAL_BLOCKED` e autorização explícita do
  proprietário para baseline + deploy automático do Pages. Nenhuma cobrança,
  envio ou mutação de dados reais nesta WO.
- **Entregue neste delta (a auditar):** tema claro/escuro/system; superadmin
  singleton UUID+AAL2 fail-closed; trial idempotente com revisão; catálogo dos
  dois planos e feature keys; entitlements/quotas server-side; contratos de
  cobrança por plano com Profissional desativado; console `/admin` e
  configurações de conta.
- **Evidência revalidada no HEAD de código:** 94 unit, 39 DB, 13 PostgREST,
  15 Edge Functions typechecked, 25 Edge HTTP, 7 grupos full-local, restore
  com as 8 tabelas V2 e smoke light/dark/system desktop/mobile. `npm audit`
  mantém 0 HIGH/CRITICAL e 9 moderate.
- **PR da Parte 1:** [#89](https://github.com/KayzenRoot/pedeoutra/pull/89), Draft, CI verde no HEAD de código `8e777de`; sem merge.
- **Status:** `PART 1 ACTIVE IN PRODUCTION — ADMIN BOOTSTRAP PENDING MFA`,
  mantendo `COMMERCIAL_BLOCKED` e `GO_LIVE_BLOCKED` (SMTP, backup,
  suporte/legal, primeira cobrança e gates das Partes 2–5).
- **Ativação (2026-11-13):** PR #89 mergeada em `main` (`57511a3`), CI
  `43525061298` success; 2 migrations aplicadas após export manual; 15 Edge
  Functions ativas; Pages no novo frontend. Dados reais preservados.
  `ADMIN_BOOTSTRAP_BLOCKED` até o proprietário cadastrar TOTP/AAL2 e rodar o
  assistente de bootstrap. Nenhuma cobrança, e-mail ou envio real.
- **Bloqueios mantidos:** `ADMIN_BOOTSTRAP_BLOCKED` (e-mail do superadmin não
  fornecido), `PRO_PLAN_CHECKOUT_DISABLED` (funcionalidade da Parte 2/4 ainda
  não pronta) e `PLAN_CHANGE_REQUIRES_SUPPORT` (limite do Asaas em assinatura
  de cartão não validado para troca sem dupla cobrança).
- **Não promovido:** ADR-010 a ADR-013 permanecem PROPOSED; ADR-007/009 e o
  veredito comercial não foram alterados.

## Checkpoint Delta — PDA-V2-P02-WO-001 (PROPOSED)

- **Branch/PR:** `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp`,
  [#90](https://github.com/KayzenRoot/pedeoutra/pull/90), Draft; nada da Parte 2
  foi aplicado em produção.
- **Entregue:** categorias/fotos privadas (#52), SKU e pedido rápido (#47),
  mínimos/múltiplos (#49), importação CSV/XLSX (#46), templates (#57), QR (#53),
  acompanhamento por token (#50), preços por comprador (#48), orçamentos com
  aceite opaco (#51), comprovante PDF não fiscal (#55), comparação comercial dos
  planos (#63), contrato WhatsApp oficial com envio desligado (#29–#31) e
  equipe/RBAC com convites manuais (#58), radar de recompra (#44), lembretes
  manuais (#45), analytics first-party do funil (#78), financeiro administrativo
  (#79), dashboard 360° parcial (#80) e SEO técnico (#74).
- **Evidência local no HEAD de trabalho:** 69 DB, 53 Edge HTTP, 150 unit,
  49 Edge Functions typechecked, 7 grupos full-local, restore com preço,
  orçamento, WhatsApp, equipe, lembretes e analytics, e smoke
  light/dark/system.
- **Segurança #48/#51:** RLS por tenant, entitlements `private_prices`/`quotes`,
  tokens opacos com SHA-256/TTL/revogação, snapshots de preço, aceite idempotente
  com lock e um pedido por quote, headers `noindex`/`no-referrer`/`no-store`;
  RPCs internas restritas a `service_role`.
- **Pendente na Parte 2:** SMTP para envio automático de convites e ativação
  real do WhatsApp (WABA/templates/Meta); o envio permanece desligado por
  padrão e o convite manual já funciona.
- **Bloqueios mantidos:** `ADMIN_BOOTSTRAP_BLOCKED` (TOTP/AAL2 do proprietário),
  SMTP próprio para convites, WABA/templates para WhatsApp e
  `COMMERCIAL_BLOCKED`/`GO_LIVE_BLOCKED`.
