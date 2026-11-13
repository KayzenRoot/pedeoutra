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

- 70 testes unitários/componente, 30 testes de banco/RLS, 13 testes HTTP via
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

## Pendências

- Primeira cobrança real controlada, com autorização explícita.
- Domínio próprio e auditoria independente.
- Supabase Pro e migração para `sa-east-1` antes de pagantes.
- Monitorar o workflow `supabase-keepalive`; falha por dois dias exige
  verificação manual do projeto.

## Próxima ação autorizada

PR #12 mesclado: https://github.com/KayzenRoot/pedeoutra/pull/12

CI da `main`: run 43415994717 (merge `0c6aa6e`) — 4 jobs verdes.

O staging está encerrado e limpo; o Asaas produção está configurado e validado
sem cobrança. O próximo passo é a primeira cobrança real controlada, domínio
próprio, Supabase Pro/migração de região e auditoria, sem cobrança real sem nova
autorização.
