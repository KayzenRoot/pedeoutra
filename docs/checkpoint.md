# Checkpoint

## Base da execução

- Data: 2026-11-12
- Repositório: `KayzenRoot/pedeoutra` (público)
- Branch de trabalho: `feat/PDA-MVP-WO-001-pedeoutra-mvp`
- Base SHA: `40990e437a455f161fd8c60f35be983f29209794`
- Estado da base: somente `README.md` inicial; 11 issues abertas (PDA-001..011).
- Credenciais disponíveis: GitHub autenticado. Ausentes: Supabase Cloud,
  Asaas e Cloudflare.
- Docker disponível: sim (Postgres 17 local para testes).

## Incrementos desta WO

1. Source Pack canônico e Context Lock.
2. Scaffold React/Vite/TS, lint, typecheck, testes e CI.
3. Schema, migrations, RLS, RPCs e testes A/B.
4. Edge Functions públicas/autenticadas e billing com mocks.
5. Landing, auth, onboarding, painel, catálogo, recompra e billing UI.
6. Suíte crítica, restore, Evidence Bundle, PR Draft.

## Resultado final

- 68 testes unitários/componente, 30 testes de banco/RLS, 13 testes HTTP via
  PostgREST, 17 testes HTTP dos handlers Deno, restore, typecheck das 11 Edge
  Functions, build e smoke de browser com axe WCAG 2 A/AA verdes.
- Harness E2E completo com GoTrue real + Asaas mock: 7 grupos PASS no CI
  (run 43312787193), incluindo checkout, webhook, reembolso e reconciliação.
- Migrations aplicadas com sucesso em stack Supabase local.
- Edge Runtime Docker local bloqueado por imagem publicada com binário 0-byte;
  handlers executados via router Deno local para os testes.
- Asaas Sandbox e deploy Cloudflare/Supabase Cloud `BLOCKED` por ausência de
  credenciais autorizadas. Nenhuma URL de produção foi declarada.

## Checkpoint Delta (PROPOSED)

- ADR PDA-ADR-003/004/005/006 propostos.
- Billing Asaas sandbox e deploy permanecem bloqueados por ausência de
  credenciais; integração e runbooks entregues.
- Nenhuma alteração de escopo, marca ou domínio foi promovida.

## Próxima ação autorizada

PR Draft: https://github.com/KayzenRoot/pedeoutra/pull/12

CI real: runs 43311754455 — 4 jobs verdes (web/axe, banco/PostgREST/restore, Deno/Edge HTTP, E2E full).

Revisar o PR Draft, executar auditoria independente e, com credenciais
autorizadas, configurar Supabase/Asaas/Cloudflare e repetir os smokes de
produção. Não há merge automático.
