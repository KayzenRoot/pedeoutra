# PedeOutra V2 — revisão final do branch (PROPOSED)

Data: 2026-11-16
Branch: `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp`
PR: [#90](https://github.com/KayzenRoot/pedeoutra/pull/90) — Ready for review
HEAD de código revisado: `48cca3d`
Base de produção: `main` com Parte 1 ativa (`57511a3`)

## Estado por parte

| Parte | Estado | Observação |
| --- | --- | --- |
| 1/5 | ativa em produção | admin bootstrap concluído com TOTP/AAL2 em 2026-11-16 |
| 2/5 | **deployada em produção** | #46–#58, #63; backup + 19 migrations + 57 funções em 2026-11-16 |
| 3/5 | deployada no escopo interno | #44/#45/#78/#79; #34–#42 dependem de DeepSeek/Resend/Meta e orçamento |
| 4/5 | deployada no escopo interno | API B2B v1 leitura (#64/#65/#66/#67); #68–#71 dependem de Meta/DeepSeek |
| 5/5 | **deployada no escopo interno** | #73–#76/#80–#82; #72/#83 produção parcial |

## Evidência final (HEAD 4718946)

| Verificação | Resultado |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **161 PASS, 0 FAIL** (34 arquivos) |
| `npm run test:db` | **79 PASS, 0 FAIL** |
| `npm run test:edge` | **57 Edge Functions** typechecked |
| `npm run test:edge-http` | **57 PASS, 0 FAIL** |
| `npm run test:full-local` | **7 PASS, 0 FAIL** |
| `npm run test:restore` | PASS, contagens/checksums idênticos |
| `npm run build` | exit 0 |
| `npm run test:seo` | PASS HTML inicial, canonical/JSON-LD, sitemap, robots e 404 real |
| `npm run smoke:preview` | PASS light/dark/system desktop/mobile, axe 0 violações |
| SonarCloud PR #90 | **0 issues; quality gate OK**; duplicação new-code 1.2% |

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
- #54 relatório de clientes inativos, recorrência e valor em pedidos, com CSV seguro e histórico.
- #55 comprovante PDF A4 não fiscal, com versão sem PII.
- #56 indicações com código opaco, antifraude e recompensa pendente sem efeito financeiro.
- #57 templates de catálogo idempotentes.
- #58 equipe/RBAC, convites manuais AAL2, limite de 3 e revogação.
- #29–#31 contrato WhatsApp, opt-in, outbox, worker/webhook; envio desligado.
- #63/#74/#75 landing de dois planos, SEO técnico e páginas setoriais.
- #64/#65/#66/#67 API B2B v1 de leitura, chaves/escopos/quota, OpenAPI e webhooks assinados.
- #44/#45 radar de recompra e lembretes manuais com opt-in.
- #78 analytics first-party consentido, com admin agregado.
- #79 métricas financeiras e #80 dashboard interno com período, saúde e integrações.
- #73 prerender comercial + 404 real; #74/#75 SEO/setores; #76 monitoramento SEO em CI; #82 landing V2; #81 componentes visuais, tilt e Reveal acessíveis.
- #83 auditoria integrada interna aprovada; #72 gate de produção com deploy
  concluído em 2026-11-16 e verificação pós-deploy parcial.

## Invariantes de segurança verificados

- RLS por tenant em todas as tabelas novas; testes A/B.
- Edge refaz checagem de sessão, papel, entitlement e tenant.
- Tokens de recompra/preço/orçamento/convite armazenados como hash; TTL/revogação.
- Segredos WhatsApp/webhook cifrados no servidor; nunca retornados após criação.
- API keys somente hash, escopos, quota e revogação; webhooks com HMAC.
- Nenhum pedido B2B é receita SaaS; MRR/recebimento/lucro separados.
- Analytics sem PII, IP integral, token ou query privada; consentimento e DNT/GPC.
- CPD do Sonar exclui migrations/testes históricos, que repetem corpos de função e fixtures de propósito; o código de produção segue medido.
- Nenhuma cobrança, envio real de WhatsApp/e-mail ou compra de serviço neste branch.

## Bloqueios externos e pendências reais

- `ADMIN_BOOTSTRAP` resolvido em 2026-11-16 (TOTP/AAL2 + `platform_admins`).
- SMTP próprio para envio automático de convites (o link manual já funciona).
- WABA/Meta e templates aprovados para ativar WhatsApp automático.
- Meta Ads/DeepSeek/Resend e orçamento da Central de Crescimento (#34–#42/#68–#71).
- GSC/Core Web Vitals de campo (#76) e auditoria em ambiente real (#72/#83).
- Deploy das Partes 2–5 concluído em 2026-11-16 (`evidence/PDA-V2-DEPLOY-2026-11-16.md`); qualquer cobrança real continua dependendo de autorização explícita.

## Veredito proposto

`PART 2–5 DEPLOYED / POST_DEPLOY_VERIFICATION_PARTIAL / COMMERCIAL_BLOCKED`
com `COMMERCIAL_BLOCKED` e `GO_LIVE_BLOCKED` mantidos. O merge e o deploy
produtivo foram executados em 2026-11-16 com autorização explícita; nenhuma
cobrança, e-mail, WhatsApp ou crédito real foi executado.
