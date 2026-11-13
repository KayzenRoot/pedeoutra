# Checkpoint

## Base da execução

- Data: 2026-11-12/13
- Repositório: `KayzenRoot/pedeoutra` (público)
- Branch de trabalho: `feat/PDA-MVP-WO-001-pedeoutra-mvp`
- Base SHA: `40990e437a455f161fd8c60f35be983f29209794`
- Estado da base: somente `README.md` inicial; 11 issues abertas (PDA-001..011).
- Credenciais usadas: GitHub, Supabase Cloud, Asaas Sandbox e Cloudflare Pages.
- Docker disponível: sim; reparado com `wsl --update` + reinício do backend.

## Incrementos desta WO

1. Source Pack canônico e Context Lock.
2. Scaffold React/Vite/TS, lint, typecheck, testes e CI.
3. Schema, migrations, RLS, RPCs e testes A/B.
4. Edge Functions públicas/autenticadas e billing com mocks.
5. Landing, auth, onboarding, painel, catálogo, recompra e billing UI.
6. Suíte crítica, restore, Evidence Bundle, PR Draft.

## Resultado final

- 70 testes unitários/componente, 30 testes de banco/RLS, 13 testes HTTP via
  PostgREST, 17 testes HTTP dos handlers Deno, restore, typecheck das 11 Edge
  Functions, build e smoke de browser com axe WCAG 2 A/AA verdes.
- Harness E2E completo com GoTrue real + Asaas mock: 7 grupos PASS no CI.
- Migrations aplicadas no Supabase Cloud (`waygtbclkxklexnabwvj`).
- Frontend publicado em Cloudflare Pages: `https://pedeoutra.pages.dev`, agora
  projeto Git conectado a `KayzenRoot/pedeoutra` com auto-deploy por push.
- 11 Edge Functions publicadas; secrets configurados (sem valores no repo).
- Asaas Sandbox: checkout real, pagamento de teste, webhook autenticado e
  assinatura ativada; smoke completo de produção PASS. Assinatura/cliente e
  dados sintéticos removidos em 13/11 para deixar o staging limpo.
- Docker local corrigido com `wsl --update` + reinício do backend do Docker
  Desktop; `test:db` 30/30, `test:postgrest` 13/13, `test:edge-http` 17/17,
  `test:full-local` 7/7 e `test:restore` PASS executados localmente.
- Produção monetizada permanece BLOCKED (Asaas produção, domínio e auditoria).

## Pendências

- Auditoria independente e autorização explícita antes de merge do PR #12.
- Trocar a branch de produção do Pages para `main` depois do merge.
- Asaas produção (KYC/credenciais), domínio próprio e revisão do plano Supabase
  Free antes de usuários pagantes.
- Região East US (Ohio) documentada; migrar para São Paulo exige recriar o
  projeto Supabase.

## Próxima ação autorizada

PR Draft: https://github.com/KayzenRoot/pedeoutra/pull/12

CI real: run 43357841432 (push `2993e67`) — 4 jobs verdes (web/axe,
banco/PostgREST/restore, Deno/Edge HTTP, E2E full).

Revisar o PR Draft, executar auditoria independente e, com autorização
explícita, fazer o merge. Não há merge automático.
