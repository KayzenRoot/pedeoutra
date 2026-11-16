# PedeOutra V2 — matriz de aceitação (#59)

Data: 2026-11-16
Branch: `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp`
PR: #90 — Draft, sem deploy
Veredito: **INTERNAL_SCOPE_ACCEPTED / PRODUCTION_BLOCKED**

## Features aprovadas (#44–#58)

| Issue | Feature | Implementação | Evidência/teste | Estado |
| --- | --- | --- | --- | --- |
| #44 | Radar de recompra | `20261114000700_reorder_radar.sql`, `Radar.tsx` | DB "radar calcula mediana…"; unit Radar | PASS interno |
| #45 | Lembretes manuais | `20261114000800_reorder_reminders.sql`, `reorder-reminder-*` | DB lembretes; Edge HTTP #13 | PASS interno; envio automático desligado |
| #46 | Importação CSV/XLSX | `20261113000600_product_import.sql`, `ProductImportPanel` | DB importação; unit import; Edge import | PASS interno |
| #47 | SKU e pedido rápido | `20261113000400_product_sku.sql`, `sku.ts` | DB SKU; unit sku | PASS interno |
| #48 | Preços por comprador | `20261114000300_customer_prices.sql`, `private-catalog-get` | DB preços; Edge HTTP #9; PrivatePrices tests | PASS interno |
| #49 | Mínimos e múltiplos | `20261113000500_order_rules.sql` | DB regras de quantidade; Edge pedido | PASS interno |
| #50 | Acompanhamento por token | `20261114000200_order_tracking.sql`, `Tracking.tsx` | DB tracking; Tracking test; Edge HTTP | PASS interno |
| #51 | Orçamentos B2B | `20261114000400_quotes.sql`, `quote-*` | DB orçamentos; Edge HTTP #10; Quotes/QuotePublic tests | PASS interno |
| #52 | Categorias e mídia | `20261113000300_catalog_media.sql`, `ProductMediaManager` | DB mídia; CatalogQr/media tests; Edge HTTP | PASS interno |
| #53 | QR code | `CatalogQrPanel.tsx`, `qr.ts` | unit qr; CatalogQrPanel test | PASS interno |
| #54 | Clientes inativos/recorrência/valor | `20261115000100_customer_insights.sql`, `CustomerReport.tsx` | DB #13; unit customer-report; CustomerReport test | PASS interno |
| #55 | Comprovante PDF | `order-pdf.ts`, `OrderDetail.tsx` | unit order-pdf; Edge HTTP | PASS interno; não fiscal |
| #56 | Indicações | `20261115000200_referrals.sql`, `ReferralPanel.tsx` | DB #14; Edge HTTP admin; unit ReferralPanel | PASS interno; recompensa pendente |
| #57 | Templates de catálogo | `20261114000100_catalog_seed.sql`, `CatalogTemplatePicker` | DB template; unit onboarding-templates | PASS interno |
| #58 | Equipe/RBAC | `20261114000600_team_rbac.sql`, `team-*` | DB equipe; Edge HTTP #12; Team test | PASS interno; SMTP manual |

## Complementos Parte 3–5

| Issue | Feature | Evidência | Estado |
| --- | --- | --- | --- |
| #29–#31 | WhatsApp oficial/outbox | DB outbox; Edge HTTP #11; `WhatsAppPanel` | Contrato interno; envio desligado/WABA_BLOCKED |
| #63/#81/#82 | Landing/design system | smoke + axe; `design.tsx`; `Landing.tsx`; `docs/design-system.md` | PASS interno; CWV de campo externo |
| #64–#67 | API B2B v1 + webhooks | DB API keys/webhooks; Edge HTTP #15/#16; OpenAPI | PASS interno; entrega webhook desligada |
| #73/#74/#75/#76 | SEO, prerender, setores | `test:seo`; smoke; `docs/seo-runbook.md` | PASS técnico; GSC/CWV EXTERNAL_SETUP_REQUIRED |
| #78/#79/#80 | Analytics/financeiro/dashboard | DB analytics/finance/health; Admin tests; Edge HTTP #14 | PASS interno |
| #72/#83 | Auditoria final | `PDA-V2-FINAL-AUDIT.md`, este documento | APPROVED FOR DRAFT REVIEW; DEPLOY_BLOCKED |

## Critérios transversais

- [x] RLS A/B e tenant isolation nas features novas.
- [x] Nenhum `service_role`, token, chave ou segredo no browser/repo/log.
- [x] Migrations aditivas, `search_path` fixo e grants mínimos.
- [x] Testes de DB, Edge HTTP, unit e smoke verdes no HEAD de trabalho.
- [x] Nenhum dado real, cobrança, crédito ou envio externo nos testes.
- [x] Dados reais de produção preservados; nenhuma migration aplicada em prod.
- [ ] Deploy autorizado do SHA exato e auditoria em ambiente real.
- [ ] SMTP/WABA/Meta/DeepSeek/Resend/backup/legal/primeira cobrança.
- [ ] Aprovação financeira específica antes de conceder recompensa de indicação.

## Evidência de execução (HEAD de trabalho)

| Verificação | Resultado |
| --- | --- |
| lint/typecheck/build | 0 erros |
| unit | 161 PASS |
| DB/RLS | 79 PASS |
| Edge Functions | 57 typechecked |
| Edge HTTP | 57 PASS |
| full-local | 7 PASS |
| restore | PASS |
| SEO estático | PASS |
| smoke/axe | PASS light/dark/system desktop/mobile, 0 violações |
| SonarCloud PR #90 | 0 issues; gate OK; duplicação 1.2%; migrations imutáveis excluídas e cobertas por DB/restore |
