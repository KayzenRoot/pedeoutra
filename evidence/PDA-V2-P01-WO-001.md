# Evidence Bundle — PDA-V2-P01-WO-001 (Parte 1/5)

## 1. Identificação

| Campo | Valor |
| --- | --- |
| Work Order | `PDA-V2-P01-WO-001` (PDF, 13/11/2026) |
| Tracker | [#84](https://github.com/KayzenRoot/pedeoutra/issues/84) |
| Repositório | `https://github.com/KayzenRoot/pedeoutra` |
| Branch | `feat/PDA-V2-P01-WO-001-foundation-billing-admin` |
| Base | `40b4224d61da23a53990bf91a6fadcbd52ff969c` (merge da PR #77) |
| Head de código | `73b600effd83ca233c0e1604ee6a17c902ef5861` |
| Data | 2026-11-13 |
| Deploy/migração em produção | **não executados nesta WO** |
| Cobrança/e-mail real | **não executados** |

Este bundle descreve a Parte 1 implementada e **não** declara release pronta,
merge ou deploy. A PR permanece Draft até auditoria e autorização do
proprietário.

## 2. Gate Zero — PR #77

A PR #77 (`PDA-REL-WO-001`) foi revisada no HEAD `4c2e190` com 12 checks
verdes (4 jobs obrigatórios, SonarCloud, Socket, Pages), sem defeito
HIGH/CRITICAL conhecido. O proprietário autorizou explicitamente baseline +
merge + deploy automático do Pages; o merge normal gerou
`40b4224d61da23a53990bf91a6fadcbd52ff969c`. Ver
`evidence/PDA-REL-WO-001.md` para o bundle original da release.

## 3. Escopo entregue

| Issue | Entrega | Estado |
| --- | --- | --- |
| #24 | ADR-010 a ADR-013 PROPOSED, delta de scope/DoD/requirements/arch/security/test-plan/backlog/checkpoint e Context Lock V2 | Implementado |
| #25 | Tema claro/escuro/system com tokens semânticos, persistência e script sem flash | Implementado |
| #26 | `platform_admins` singleton, bootstrap one-time, `admin-api` com UUID+AAL2/TOTP, auditoria | Implementado; bootstrap **bloqueado** sem `ADMIN_EMAIL` |
| #28 | `trial_grants` imutável, HMAC de sinais, revisão proporcional e ações admin | Implementado |
| #60 | Matriz canônica Essencial R$ 29,90 / Profissional R$ 69,90 e feature keys | Implementado (Pro não vendido) |
| #61 | `plan_catalog`, `plan_feature_entitlements`, `assert_entitlement`, quotas atômicas | Implementado |
| #62 | Checkout por plano, validação por plano no webhook e bloqueio seguro de troca | Contrato implementado; troca automática **bloqueada** |
| #27 | `/admin` com overview, filtros, paginação, ações auditadas e fail-closed | Implementado |
| #32 | Configurações de conta, tema, plano/limites, MFA, integrações desabilitadas | Implementado |

## 4. Migrations e integridade de dados

Duas migrations aditivas, aplicadas apenas em bancos sintéticos/isolados:

| Migration | SHA-256 |
| --- | --- |
| `20261113000100_plans_entitlements.sql` | `67e47cdf1db42d70b963a380bcf90a61f4a0fa7cb199acaabd99a271544d7e02` |
| `20261113000200_admin_trial.sql` | `e4a82425c7b7edd869d361db6c3f308e201b5f06b24a8f4fb70e8319aabb0e00` |

- `plan_catalog`/`plan_feature_entitlements` semeados com 2 planos e 48 linhas
  de matriz; preços 2990/6990 BRL.
- `subscriptions` recebeu `plan_code='essential'`/`plan_version=1` por default;
  nenhuma assinatura, período, provider ou preço existente foi alterado.
- `trial_grants` foi backfilled dos trials existentes sem reiniciar prazo;
  `trial_signals` usa HMAC-SHA-256 com segredo local.
- `platform_admins` é singleton por PK; `platform_audit_events`,
  `plan_changes`, `quota_usage` e `trial_signals` têm RLS default-deny.
- Nenhum `service_role`, chave Asaas ou segredo foi versionado; nenhuma
  migration foi aplicada no Supabase Cloud nesta WO.

## 5. Comandos e resultados (HEAD de código)

| Comando | Resultado | Exit |
| --- | --- | --- |
| `npm ci` | instalação limpa | 0 |
| `npm run lint` | ESLint sem erros | 0 |
| `npm run typecheck` | app + config | 0 |
| `npm run test:unit` | **85 PASS / 0 FAIL**, 11 arquivos | 0 |
| `npm run build` | bundle gerado (aviso de chunk >500 kB) | 0 |
| `npm run test:db` | **39 PASS / 0 FAIL** | 0 |
| `npm run test:postgrest` | **13 PASS / 0 FAIL** | 0 |
| `npm run test:edge` | **15 Edge Functions** typechecked | 0 |
| `npm run test:edge-http` | **25 PASS / 0 FAIL** | 0 |
| `npm run test:full-local` | **7 PASS / 0 FAIL** | 0 |
| `npm run test:restore` | contagens/checksums idênticos, incluindo 8 tabelas V2 | 0 |
| `npm run smoke:preview` | light/dark/system, desktop/mobile, axe 0 serious/critical | 0 |
| `npm audit` | **0 HIGH / 0 CRITICAL**, 9 moderate | 1 (esperado) |

Os logs completos desta execução estão em `evidence/logs/` no ambiente local
de execução; os dados sintéticos foram removidos pelos próprios harnesses.

## 6. Prova de segurança

| ID | Prova | Resultado |
| --- | --- | --- |
| PO-01 | Tenant A não lê/escreve B em DB, RLS e PostgREST | PASS — 39 DB + 13 PostgREST |
| PO-02 | Trial/assinatura inválida não escreve | PASS — DB |
| PO-03 | Trial é único por usuário e sobrevive à recriação da org | PASS — DB |
| PO-04 | Telefone repetido abre revisão sem bloquear o trial | PASS — DB |
| PO-05 | E-mail repetido abre revisão; admin limpa/suspende com auditoria | PASS — DB |
| PO-06 | Superadmin é singleton; segundo admin é rejeitado | PASS — DB |
| PO-07 | Admin global exige UUID + AAL2/TOTP; AAL1, fornecedor, anônimo e expirado são rejeitados | PASS — 4 negativos Edge HTTP |
| PO-08 | Bootstrap sem `ADMIN_EMAIL` falha fechado com `ADMIN_BOOTSTRAP_BLOCKED` | PASS — Edge HTTP em processo sem env |
| PO-09 | 2990 não libera Profissional e 6990 não libera Essencial | PASS — unit billing |
| PO-10 | Feature Pro é negada a trial/Essencial e liberada só com assinatura Pro ativa | PASS — DB |
| PO-11 | Quota é atômica, isolada por tenant e bloqueia antes do side effect | PASS — DB |
| PO-12 | Troca de plano sem caminho Asaas seguro é bloqueada e auditada | PASS — Edge HTTP |
| PO-13 | Restore preserva planos, trials, admin, auditoria e quotas | PASS — restore |
| PO-14 | Nenhum segredo no bundle; chave anon tem role `anon` | PASS — varredura |

## 7. UI e acessibilidade

- Screenshots versionados no HEAD: `landing-desktop.png`,
  `landing-dark-desktop.png`, `landing-mobile.png`,
  `landing-dark-mobile.png`, `demo-dark-desktop.png`.
- Smoke desktop (1360 px) e mobile (390 px) em light/dark; preferência
  `system` resolve pelo SO sem flash.
- axe WCAG 2 A/AA: 0 violações serious/critical nas combinações testadas.
- `theme-init.js` é externo (compatível com CSP `script-src 'self'`) e roda
  antes do app.
- Nenhuma certificação WCAG é declarada; apenas o resultado do smoke.

## 8. Bloqueios mantidos (fail-closed)

1. **ADMIN_BOOTSTRAP_BLOCKED** — `ADMIN_EMAIL` e `ADMIN_BOOTSTRAP_TOKEN` não
   foram fornecidos pelo proprietário; `/admin` permanece sem bootstrap.
2. **PRO_PLAN_CHECKOUT_DISABLED** — Profissional não é vendido enquanto a
   funcionalidade real da Parte 2/4 não estiver pronta; `plan-catalog` expõe
   `available=false`.
3. **PLAN_CHANGE_REQUIRES_SUPPORT** — o Asaas não permite editar
   valor/vencimento de assinatura de cartão após cobranças confirmadas; criar
   segunda recorrência é proibido. A troca fica bloqueada até caminho
   homologado.
4. **SMTP_BLOCKED / BACKUP_BLOCKED / LEGAL_SUPPORT_BLOCKED /
   LIVE_CHARGE_NOT_APPROVED** — permanecem da release; nada foi comprado,
   enviado ou cobrado.

## 9. Rollback / roll-forward

- Reverter a PR Draft não altera produção, pois nada foi implantado.
- Migrations são aditivas; rollback local = remover as duas migrations em banco
  sintético. Produção exige backup/restore aprovado antes de qualquer `db push`.
- `subscriptions.plan_code` default `essential` permite roll-forward sem
  reescrever assinaturas legadas.
- Se o admin for provisionado e precisar ser revogado, `platform_admins.revoked_at`
  remove o acesso no próximo request, sem apagar a auditoria.

## 10. Veredito

**PART 1 IMPLEMENTED — PENDING OWNER AUDIT.**

- Código, migrations, testes e UI estão implementados e verdes no HEAD de
  código.
- Não há merge, deploy, migração em produção, cobrança, e-mail ou contratação.
- O console admin está intencionalmente inoperante sem o e-mail/token do
  superadmin; o Profissional está intencionalmente indisponível.
- A promoção de ADR/checkpoint e o merge só ocorrem após auditoria e
  autorização explícita do proprietário.

## 11. Adendo — CI do PR #89

- PR Draft: https://github.com/KayzenRoot/pedeoutra/pull/89
- Head de código com CI verde: `bc2a948e6c0ffd6d7e4ecfd0a634b99ef37e0620`
- Checks verdes: Cloudflare Pages (preview), Edge Functions typecheck, Full
  local E2E, Postgres/RLS/restore, Web/unit/build, Socket Project Report,
  Socket PR Alerts e SonarCloud Code Analysis.
- O SonarCloud falhou na primeira execução por dois achados MINOR `S4036`
  (lookup de `docker`/`taskkill` via PATH em script de teste). O harness foi
  corrigido para reutilizar o helper e usar caminho absoluto do `taskkill.exe`;
  o gate final passou.
- O PR permanece **Draft**; `mergeStateStatus` não é aprovação. Nenhum merge,
  deploy de produção ou migração foi executado.
