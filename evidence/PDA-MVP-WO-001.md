# Evidence Bundle — PDA-MVP-WO-001

## 1. Identificação

| Campo | Valor |
| --- | --- |
| Repositório | `https://github.com/KayzenRoot/pedeoutra` |
| Work Order | `PDA-MVP-WO-001` (PDF, 12/11/2026) |
| Branch | `feat/PDA-MVP-WO-001-pedeoutra-mvp` |
| Base SHA | `40990e437a455f161fd8c60f35be983f29209794` |
| Head de código | `02e3da2bd90108096c15997e26229cb927079eaf` |
| Data da execução | 2026-11-12 |
| Ambiente | Windows 11, Node 26.4, npm 11.17, Docker 29.8, Supabase CLI 2.113, Chrome headless |
| PR Draft | criado após o push; URL final no relatório de entrega |
| Deploy | **NÃO EXECUTADO / BLOCKED** — sem credenciais Cloudflare/Supabase Cloud |
| Billing | **PROD BLOCKED** — sem credenciais Asaas Sandbox |

Nenhuma URL de produção foi inventada. Nenhum pagamento real foi executado.
Nenhum merge foi feito.

## 2. Issues PDA-001..011

As 11 issues já existiam no GitHub. Nenhuma duplicata foi criada.

| Issue | Status | Evidência |
| --- | --- | --- |
| PDA-001 Source Pack, base e CI | DONE | `docs/`, `README.md`, `.github/workflows/ci.yml`, logs de lint/typecheck/build |
| PDA-002 Auth, organizações e RLS | DONE (local) | migrations, `create_organization`, 29 testes de banco, 13 testes PostgREST; Auth Cloud não configurado |
| PDA-003 Produtos e clientes | DONE | UI, RLS, testes de banco/PostgREST |
| PDA-004 Catálogo e pedido público | DONE | `public-catalog`, `public-order`, 17 testes HTTP dos handlers, total server-side |
| PDA-005 Recompra segura | DONE | tokens unitários, RPC/DB, `reorder-create/get/submit/revoke`, 17 testes HTTP |
| PDA-006 Painel e WhatsApp manual | DONE (UI) | telas de pedidos/status/histórico, links `wa.me` manuais; sem API WhatsApp |
| PDA-007 Trial, plano e Asaas | PARTIAL / PROD BLOCKED | trial e gate server-side testados, máquina de billing com 22 testes, checkout/webhook implementados; Asaas sem credenciais |
| PDA-008 Testes críticos e restore | DONE | 64 unit, 29 DB, 13 PostgREST, 17 Edge HTTP, restore PASS |
| PDA-009 Landing e onboarding | DONE | landing, demo, privacidade/termos preliminares, smoke de browser |
| PDA-010 Deploy e smoke comercial | BLOCKED | sem credenciais; runbook em `docs/deployment.md`; nenhuma URL declarada |
| PDA-011 Evidence Bundle e PR | DONE (sem merge) | este bundle + PR Draft |

## 3. Entregáveis

- Aplicação React/Vite/TS mobile-first: landing, cadastro/login, onboarding,
  painel, produtos, clientes, pedidos, assinatura, catálogo público, recompra,
  demo fictícia e páginas legais preliminares.
- Banco Supabase: 4 migrations com tabelas, constraints, índices, triggers,
  RLS default-deny, funções `security definer`, view segura e wrappers de API.
- 11 Edge Functions: catálogo/pedido/recompra, vínculo de cliente, checkout,
  cancelamento, webhook Asaas, reconciliação.
- CI GitHub Actions com três jobs (web, banco/restore/PostgREST, Deno/Edge HTTP).
- Scripts de teste reproduzíveis e logs em `evidence/logs/`.
- Screenshots em `evidence/screenshots/`.
- Source Pack conciso em `docs/`.

### Dependências novas

Runtime: `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`.
Desenvolvimento: `vite`, `typescript`, `eslint`, `typescript-eslint`, `vitest`,
`jsdom`, `@testing-library/*`, `pg`, `playwright-core`.

Não foi adicionado serviço pago, fonte externa, SDK de analytics ou dependência
de UI pesada. Licenças predominantes: MIT/Apache-2.0; revisar o lockfile antes do
deploy comercial. Nenhum segredo está no repositório.

## 4. Comandos, resultados e exit codes

Logs completos em `evidence/logs/`.

| Comando | Resultado | Exit | Log |
| --- | --- | --- | --- |
| `npm run lint` | ESLint sem erros/avisos | 0 | `lint.log` |
| `npm run typecheck` | `tsc` app + config | 0 | `typecheck.log` |
| `npm run test:unit` | 64 testes em 7 arquivos | 0 | `test-unit.log` |
| `npm run build` | JS 489,74 kB (gzip 139,59 kB); CSS 36,10 kB (gzip 7,63 kB) | 0 | `build.log` |
| `npm run test:db` | 29 PASS / 0 FAIL (RLS, trial, pedido, recompra, status, billing event) | 0 | `test-db.log` |
| `npm run test:postgrest` | 13 PASS / 0 FAIL (RPC/RLS/status via HTTP real) | 0 | `test-postgrest.log` |
| `npm run test:restore` | dump/restore, contagens e checksums idênticos | 0 | `test-restore.log` |
| `npm run test:edge` | 11 Edge Functions typechecked | 0 | `test-edge.log` |
| `npm run test:edge-http` | 17 PASS / 0 FAIL (handlers Deno reais + PostgREST) | 0 | `test-edge-http.log` |
| `npm run smoke:preview` | landing/demo/legal/404 + screenshots | 0 | `smoke.log` |
| `supabase start` | 4 migrations aplicadas no stack local | 0 | `local-supabase-start.log` |
| `npm run test:local` | NÃO EXECUTADO — Edge Runtime local bloqueado | — | `local-edge-runtime-blocked.txt` |

### Bloqueio de infraestrutura local

A imagem `public.ecr.aws/supabase/edge-runtime:v1.74.3` publicada nesta máquina
tinha binário de 0 byte e falhava com `exec format error`. A tag anterior
`v1.69.4` executava, mas o stack local foi encerrado com exit 137 sob pressão de
recursos. Para não deixar a WO sem prova dos handlers, os módulos Deno reais
foram executados por `scripts/local-edge-router.ts` contra PostgREST + Postgres
reais (`test:edge-http`). O caminho de Auth Cloud/GoTrue real permanece não
validado; o teste usa stub de GoTrue apenas para o contrato de sessão.

## 5. Matriz HIGH_ASSURANCE

| Obrigação | Controle | Evidência |
| --- | --- | --- |
| Nenhum tenant consulta outro | RLS default-deny + `is_org_owner` + testes A/B | `test-db` 9 testes; `test-postgrest` 3 testes |
| Forjar `organization_id` não funciona | `WITH CHECK` nas policies + FK composta | `test-db`: insert cross-tenant rejeitado; PostgREST 4xx |
| Nada desbloqueia sem pagamento confirmado | gate SQL por trial/assinatura + máquina de billing | `test-db`: trial/reembolso/bloqueio; `billing.test`: 22 testes |
| Callback de sucesso não ativa | nenhum caminho de `successUrl` no estado; ativação exige evento + verificação | `billing.test` + revisão de `create-checkout` |
| Webhook duplicado é inofensivo | `provider_event_id UNIQUE` + `register_billing_event` | `test-db` evento duplicado; `billing.test` |
| Webhook inválido/valor/tenant divergente | token constante + validação de valor/tenant/estado | `billing.test`; handler typechecked; webhook HTTP real não executado (sem Asaas) |
| Evento fora de ordem não reativa/refund revoga | `last_provider_event_at` + estado terminal | `billing.test` 22 testes |
| Token de recompra não vaza | hash SHA-256, TTL, revogação, rate limit, view sem token | `tokens.test`, `test-db`, `test-edge-http` (sem PII) |
| Preço/total não são do cliente | RPC calcula com produto atual e snapshots | `test-db`, `test-postgrest`, `test-edge-http` |
| Produto inativo ou de outro tenant | validação no RPC | `test-db`, `test-edge-http` |
| Abuso de pedidos/anti-spam | rate limit atômico, honeypot, elapsed, limites | `test-db`, `test-edge-http` (429) |
| Isolamento de API pública | anon sem grants; DTO público mínimo | `test-db` anon; `test-postgrest`; `test-edge-http` |
| Restore verificável | `pg_dump`/`pg_restore` em dados sintéticos | `test-restore` |
| Acesso pausado em trial/reembolso | `org_can_write` no banco e nas policies | `test-db` |

## 6. Segurança e privacidade

- RLS habilitada em todas as tabelas de negócio; `anon` sem acesso; `service_role`
  apenas nas Edge Functions.
- `token_hash` nunca é exposto; a view `reorder_links_safe` omite a coluna.
- Headers em `public/_headers`: CSP, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy`, `nosniff`.
- Recompra com `noindex` e página neutra quando o token é inválido/revogado.
- Analytics desativado por padrão; quando habilitado envia evento e rota saneada,
  sem token/query string/PII.
- Nenhum dado de cartão passa pelo PedeOutra.
- LGPD: minimização, aviso no pedido, retenção documentada e canais preliminares.

## 7. Billing

- Plano único 2990 centavos no servidor; trial de 7 dias no banco.
- Checkout hospedado Asaas com `externalReference` da organização, callback
  apenas informativo e webhook com `asaas-access-token`.
- `subscriptions` guarda apenas ids/status; `billing_events` é idempotente.
- Estados: `pending`, `active`, `past_due`, `canceled`, `expired`, `refunded`.
- `create-checkout`/`cancel-subscription` retornam 503 controlado sem credenciais.
- **PROD BLOCKED**: sandbox real, webhook real e cobrança não executados.

## 8. Deploy

- **BLOCKED**: sem Supabase Cloud, Asaas e Cloudflare autorizados.
- Nenhuma URL pública, TLS ou smoke de produção foi declarado.
- Runbook, variáveis e rollback em `docs/deployment.md`.
- Cloudflare Pages é o alvo; Vercel Hobby não é usado para SaaS pago.

## 9. Riscos, limites e correções

- Auth Cloud/GoTrue real não validado; stub de teste cobre apenas o contrato.
- Webhook Asaas não executado de ponta a ponta; lógica e validações unitárias/DB
  cobertas.
- Edge Runtime Docker local indisponível nesta máquina (imagem 0-byte/exit 137).
- Sem WAF dedicado, pentest externo ou teste de carga.
- Supabase Free pode pausar; revisar plano antes de pagantes.
- Bundle JS ~490 kB (139 kB gzip); aceitável para MVP, monitorar.
- Correções feitas durante a WO: grants de execução de triggers, view
  `security_invoker` com grants de coluna, `CHECKOUT_PAID` exige status `PAID`
  (não apenas assinatura `ACTIVE`), ajuste de sobreposição do hero e tabelas
  responsivas no mobile.
- Nenhum defeito HIGH/CRITICAL conhecido dentro do escopo testado.

## 10. Checkpoint Delta (PROPOSED)

- ADR-003: APIs públicas exclusivamente via Edge Functions — PROPOSED.
- ADR-004: CSS moderno em vez de Tailwind — PROPOSED.
- ADR-005: máquina de estados de pedido no banco — PROPOSED.
- ADR-006: recompra com token opaco/hash — PROPOSED.
- Billing e deploy permanecem bloqueados até credenciais e auditoria.
- Nenhuma promoção canônica automática; nenhum merge.

## 11. Veredito

- **Implementação local:** PASS (app, schema, RLS, pedido, recompra, testes,
  build e smoke).
- **Segurança testada:** PASS no escopo de tenant, pedido, recompra, rate limit e
  restore; sem defeito HIGH/CRITICAL conhecido.
- **Billing real:** BLOCKED (sem Asaas).
- **Deploy comercial:** BLOCKED (sem Supabase/Cloudflare).
- **Veredito final:** **BLOCKED para go-live comercial**, com implementação
  local aprovada para auditoria e PR Draft. Não é `APPROVED` de produção e não é
  `CORRECTION REQUIRED` por defeito conhecido.
