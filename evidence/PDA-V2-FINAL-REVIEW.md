# PedeOutra V2 — revisão final do branch (PROPOSED)

Data: 2026-11-14
Branch: `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp`
PR: [#90](https://github.com/KayzenRoot/pedeoutra/pull/90) — Draft
HEAD de código revisado: `9814a6f`
Base de produção: `main` com Parte 1 ativa (`57511a3`)

## Estado por parte

| Parte | Estado | Observação |
| --- | --- | --- |
| 1/5 | ativa em produção | admin bootstrap ainda pendente de TOTP/AAL2 |
| 2/5 | completa no branch | #46–#58, #63; sem deploy de produção |
| 3/5 | parcial | #44/#45/#78/#79; #34–#42 dependem de DeepSeek/Resend/Meta e orçamento |
| 4/5 | parcial | API B2B v1 leitura (#64/#65/#66/#67); #68–#71 dependem de Meta/DeepSeek |
| 5/5 | parcial | #74/#75 e landing de dois planos; #72/#73/#76/#81–#83 pendentes |

## Evidência final (HEAD 9814a6f)

| Verificação | Resultado |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **150 PASS, 0 FAIL** (30 arquivos) |
| `npm run test:db` | **71 PASS, 0 FAIL** |
| `npm run test:edge` | **57 Edge Functions** typechecked |
| `npm run test:edge-http` | **56 PASS, 0 FAIL** |
| `npm run test:full-local` | **7 PASS, 0 FAIL** |
| `npm run test:restore` | PASS, contagens/checksums idênticos |
| `npm run build` | exit 0 |
| `npm run smoke:preview` | PASS light/dark/system desktop/mobile, axe 0 violações |

Logs: `evidence/logs/{lint,typecheck,test-unit,test-db,test-edge,test-edge-http,test-full-local,test-restore,build,smoke}.log`.

## Incrementos implementados no branch

- #46 importação CSV/XLSX com dry-run, job idempotente e rollback.
- #47 SKU normalizado, busca e pedido por lista de SKU.
- #48 preços por comprador, tabela privada, link opaco e fallback público.
- #49 mínimos/múltiplos no servidor e na UI.
- #50 acompanhamento por token opaco, TTL e revogação.
- #51 orçamentos com aceite opaco, lock, idempotência e conversão única.
- #52 categorias e mídia privada com magic bytes.
- #53 QR local e downloads seguros.
- #55 comprovante PDF A4 não fiscal, com versão sem PII.
- #57 templates de catálogo idempotentes.
- #58 equipe/RBAC, convites manuais AAL2, limite de 3 e revogação.
- #29–#31 contrato WhatsApp, opt-in, outbox, worker/webhook; envio desligado.
- #63/#74/#75 landing de dois planos, SEO técnico e páginas setoriais.
- #64/#65/#66/#67 API B2B v1 de leitura, chaves/escopos/quota, OpenAPI e webhooks assinados.
- #44/#45 radar de recompra e lembretes manuais com opt-in.
- #78 analytics first-party consentido, com admin agregado.
- #79 métricas financeiras administrativas; #80 parcial (overview, organizações, auditoria, funil e financeiro).

## Invariantes de segurança verificados

- RLS por tenant em todas as tabelas novas; testes A/B.
- Edge refaz checagem de sessão, papel, entitlement e tenant.
- Tokens de recompra/preço/orçamento/convite armazenados como hash; TTL/revogação.
- Segredos WhatsApp/webhook cifrados no servidor; nunca retornados após criação.
- API keys somente hash, escopos, quota e revogação; webhooks com HMAC.
- Nenhum pedido B2B é receita SaaS; MRR/recebimento/lucro separados.
- Analytics sem PII, IP integral, token ou query privada; consentimento e DNT/GPC.
- Nenhuma cobrança, envio real de WhatsApp/e-mail ou compra de serviço neste branch.

## Bloqueios externos e pendências reais

- `ADMIN_BOOTSTRAP_BLOCKED`: proprietário precisa cadastrar TOTP/AAL2 e rodar o bootstrap.
- SMTP próprio para envio automático de convites (o link manual já funciona).
- WABA/Meta e templates aprovados para ativar WhatsApp automático.
- Meta Ads/DeepSeek/Resend e orçamento da Central de Crescimento (#34–#42/#68–#71).
- Prerender/status HTTP de SPA (#73), GSC (#76), landing final (#82), design system (#81), auditoria final (#72/#83).
- Deploy da Parte 2–5 em produção e qualquer cobrança real dependem de autorização explícita.

## Veredito proposto

`PART 2 COMPLETE IN BRANCH / PARTS 3–5 PARTIAL — EXTERNAL BLOCKERS`
com `COMMERCIAL_BLOCKED` e `GO_LIVE_BLOCKED` mantidos. Nenhum merge ou deploy
produtivo foi executado.
