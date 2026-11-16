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
  (#79), dashboard 360° parcial (#80), SEO técnico (#74) e API B2B v1 de
  leitura (#64/#65/#67), webhooks B2B (#66), páginas setoriais (#75),
  prerender/404 real (#73), monitoramento SEO em CI (#76) e dashboard 360°
  interno (#80), landing V2 (#82), glass/motion parcial (#81) e auditoria
  integrada interna (#83); gate final (#72) segue BLOCKED_DEPLOY.
- **Evidência local no HEAD de trabalho:** 71 DB, 56 Edge HTTP, 150 unit,
  57 Edge Functions typechecked, 7 grupos full-local, restore com preço,
  orçamento, WhatsApp, equipe, lembretes, analytics, API e webhooks, e smoke
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

## Checkpoint Delta — #54/#56/#81/#59 (PROPOSED)

- **Data:** 2026-11-16
- **Branch/PR:** `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp`, PR #90 Draft.
- **Entregue:** relatório de clientes inativos/recorrência/valor (#54), programa
  de indicações em modo seguro sem custeio (#56), biblioteca visual/motion do
  #81 (`design.tsx`) e matriz de aceitação #59. Nada foi aplicado em produção.
- **#54:** RPCs server-side, segmentos honestos, cancelados fora das métricas,
  valores separados confirmado/concluído, CSV com proteção de fórmula, viewer
  sem telefone e gate Profissional. UI `/app/relatorios`.
- **#56:** código opaco com rotação/limite/expiração, atribuição no onboarding,
  autoindicação/telefone igual bloqueados, qualificação só por pagamento
  confirmado, recompensa sempre `pending` e sem Asaas, reversão auditada.
- **#81:** `GlassCard`, `FeatureCard`, `PricingCard`, `StatCard`,
  `SectionHeading`, `IconButton`, `TiltCard` e `Reveal`; tilt ≤4° só em ponteiro
  fino; reduced motion/toque/teclado sem transform; IntersectionObserver não
  esconde conteúdo no prerender.
- **#59:** `evidence/PDA-V2-ACCEPTANCE-MATRIX.md` mapeia #44–#58, complementos
  #29–#31/#63–#83, testes, evidência e bloqueios.
- **Evidência local:** 161 unit, 79 DB, 57 Edge HTTP, 57 Edge Functions
  typechecked, 7 full-local, restore PASS, build/SEO/smoke PASS. Nenhum dado
  real, cobrança, crédito ou envio externo.
- **Bloqueios mantidos:** deploy do SHA, admin TOTP, SMTP, WABA/Meta,
  DeepSeek/Resend/Meta Ads, backup/PITR, legal/suporte, primeira cobrança real e
  aprovação financeira específica para conceder recompensa de indicação.

## Checkpoint Delta — Admin bootstrap concluído (2026-11-16)

- **ADMIN_BOOTSTRAP_BLOCKED resolvido:** superadmin `goodzlanchonete@gmail.com`
  com TOTP verificado e AAL2 confirmado; `platform_admins` contém o UUID
  `a249ea32-857a-45ae-a123-049704e0069a` e o evento
  `admin.bootstrap` foi registrado em `platform_audit_events` às
  `2026-11-16T14:51:39Z`.
- O QR de enrollment foi exibido em JPEG e removido após a confirmação; nenhum
  segredo TOTP foi versionado ou colocado em evidência.
- **PR #90** passou de Draft para **Ready for review**; continua sem merge e sem
  deploy de produção.
- **Deploy:** runbook completo em `docs/deployment.md` (backup, 19 migrations,
  42 Edge Functions, merge, verificação e rollback). Status
  `BLOCKED_AUTHORIZATION`: exige autorização explícita do proprietário e backup
  verificado.
- **Indicações:** ADR-015 PROPOSED recomenda 1 mês de crédito interno, com teto
  anual e custo máximo estimado; nenhuma concessão financeira foi ativada.
- **Externo ainda bloqueado:** SMTP, WABA/Meta, DeepSeek/Resend/Meta Ads,
  backup/PITR, legal/suporte e primeira cobrança real.

## Checkpoint Delta — Dry-run de produção (2026-11-16)

- Clone local dos dados reais de produção (schema público, `auth` e dados)
  recebeu as **19 migrations novas sem erro**; contagens reais preservadas
  (`organizations=1`, `products=1`, `orders=1`, `users=1`, `subscriptions=1`,
  `platform_admins=1`).
- RPCs novas de relatório e indicações presentes e exercitadas no clone com o
  usuário real em transação revertida.
- Dumps e container foram removidos após o teste; nenhum dado real foi
  versionado.
- Evidência: `evidence/PDA-V2-PROD-DRY-RUN.md`.
- Deploy continua `BLOCKED_AUTHORIZATION`; o runbook em `docs/deployment.md`
  exige backup fresco na janela e autorização explícita.

## Checkpoint Delta — Deploy das Partes 2–5 (2026-11-16)

- Autorização explícita do proprietário para merge/deploy do PR #90.
- Backup verificado antes das migrations: schema público, `auth` e dados; SHA-256
  e restauração de teste com contagens idênticas.
- **19 migrations aplicadas** em produção via `supabase db push --linked`; dados
  reais preservados (1 org/produto/pedido/usuário/assinatura/platform admin).
- **57 Edge Functions ACTIVE**; `verify_jwt` conferido; `admin-api` 401 sem
  token; `plan-catalog` e `public-catalog` 200.
- PR #90 mergeado em `main` (`9d3298f`); Pages produção atualizado.
- Incidente: `_redirects` com alvo `/index.html` quebrou `/app`, `/admin` e links
  opacos; corrigido para `/` no PR #92 (`ff8736c`), deploy final `11a318a2`.
- Verificação: rotas SPA 200, 404 real, noindex em `/app/*`, catálogo real e
  RPCs administrativas OK.
- Evidência: `evidence/PDA-V2-DEPLOY-2026-11-16.md`.
- Pendências comerciais mantidas: SMTP, WABA/Meta, growth, backup/PITR,
  legal/suporte, primeira cobrança e aprovação financeira de recompensa.
