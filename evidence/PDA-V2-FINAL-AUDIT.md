# PedeOutra V2 — auditoria integrada (#83) e gate final (#72)

Data: 2026-11-14
Branch: `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp`
PR: [#90](https://github.com/KayzenRoot/pedeoutra/pull/90) — Draft
HEAD auditado: `80e9a16`
Veredito: **APPROVED FOR DRAFT REVIEW / BLOCKED_DEPLOY / COMMERCIAL_BLOCKED**

## Escopo auditado

- SEO técnico, prerender, sitemap, robots, canonical, JSON-LD, noindex e 404.
- Analytics first-party, consentimento, DNT/GPC, sanitização e admin.
- Financeiro administrativo, MRR/recebimentos/reembolsos/churn e definições.
- Identidade visual, glass/fallback, motion, dark/light, mobile e axe.
- RLS/tenant, MFA/AAL2, RBAC, API keys, webhooks, WhatsApp outbox e restore.
- Regressão de pedidos, recompra, catálogo, billing e full-local.

## Evidência de execução

| Verificação | Resultado |
| --- | --- |
| lint/typecheck/build | 0 erros |
| unit | 150 PASS |
| DB/RLS | 71 PASS |
| Edge Functions | 57 typechecked |
| Edge HTTP | 56 PASS |
| full-local | 7 PASS |
| restore | PASS |
| SEO estático (`test:seo`) | PASS: HTML inicial, planos, canonical, JSON-LD, sitemap, robots, 404 real |
| smoke | PASS light/dark/system desktop/mobile; axe 0 violações |
| SonarCloud | 0 issues; quality gate OK; new-code duplication 0.9% |

Logs: `evidence/logs/` e `evidence/PDA-V2-FINAL-REVIEW.md`.

## Checklist por área

### SEO (#73–#76)
- [x] HTML inicial com H1, proposta, planos e CTAs em `/`, `/demo`, legais e setores.
- [x] `404.html` real e rewrites explícitas; sem catch-all `/* /index.html 200`.
- [x] canonical/OG/Twitter/JSON-LD e títulos por rota.
- [x] noindex HTTP para app/admin/auth/onboarding/links opacos e `/c/*`.
- [x] sitemap sem tokens/rotas privadas; robots com sitemap.
- [x] CI `test:seo`.
- [ ] Search Console/CWV de campo: **EXTERNAL_SETUP_REQUIRED** (propriedade Google e deploy autorizado). Runbook: `docs/seo-runbook.md`.

### Analytics/financeiro (#78–#80)
- [x] eventos first-party allowlisted, consentimento, DNT/GPC, path/token mascarado.
- [x] admin agregado só AAL2; fontes/UTM e funil.
- [x] MRR/recebimentos/reembolsos/churn com definições e `last_sync`.
- [x] dashboard com período 7/30/90, saúde, API/webhooks/WhatsApp/billing.
- [x] fontes Meta/DeepSeek/Resend/GSC aparecem como não conectadas, sem números falsos.
- [ ] custos/séries externas reais dependem de integrações e orçamento.

### Design/landing (#81–#82)
- [x] landing com dois planos, recursos por grupo, setores, FAQ e CTAs reais.
- [x] glass com fallback sólido, hover somente em pointer fine, reduced motion.
- [x] dark/light/system, mobile, axe.
- [ ] biblioteca completa de componentes/motion do #81 permanece parcial.

### Segurança/tenant
- [x] RLS A/B em preços, quotes, tracking, WhatsApp, equipe, analytics, API e webhooks.
- [x] MFA AAL2 para admin/equipe/chaves/webhooks; RBAC por papel.
- [x] tokens/segredos/chaves apenas como hash ou ciphertext; sem retorno após criação.
- [x] API keys com escopos, quota e revogação; webhooks com HMAC/idempotência.
- [x] WhatsApp e webhooks com entrega desligada por padrão.
- [x] Nenhum pedido B2B tratado como receita SaaS.

### Regressão (#59)
- [x] catálogo, pedido público, recompra, tracking, billing, admin e restore verdes.
- [x] logs com exit code e contagens.

## Bloqueios e o que falta para PROD READY

1. **ADMIN_BOOTSTRAP_BLOCKED:** proprietário precisa rodar
   `C:\Users\csn19\pedeoutra-secrets\bootstrap-admin.mjs` e confirmar TOTP/AAL2.
2. **DEPLOY_DA_PARTE 2–5 NÃO AUTORIZADO:** PR Draft; migrations/functions não
   aplicadas em produção. Auditoria em ambiente real exige deploy do SHA e
   autorização.
3. **SMTP_BLOCKED:** convites manuais funcionam; e-mail automático não.
4. **META/WABA_BLOCKED:** WhatsApp oficial sem envio real; WABA/templates/Meta.
5. **GROWTH_BLOCKED:** Meta Ads/DeepSeek/Resend e orçamento (#34–#42/#68–#71).
6. **BACKUP/LEGAL/COBRANÇA:** Supabase Free sem PITR, suporte/legal humano e
   primeira cobrança real não aprovados.
7. **GSC/CWV de campo:** propriedade Google e tráfego real.

## Rollback

- Nenhuma alteração de produção neste branch; reverter o PR/branch remove as
  migrations e funções novas.
- Se promovido no futuro: backup/export antes das migrations, rollback por
  migration aditiva e restauração do dump; nunca reescrever dados reais.

## Conclusão

O branch está pronto para revisão técnica e demonstração interna, com evidência
verde e sem issues Sonar. Não está autorizado para merge/deploy de produção nem
para declarar `PROD READY`: os gates externos e a auditoria em ambiente real
continuam abertos. `COMMERCIAL_BLOCKED` e `GO_LIVE_BLOCKED` permanecem.
