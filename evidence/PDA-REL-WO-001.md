# Evidence Bundle — PDA-REL-WO-001

## 1. Identificação

| Campo | Valor |
| --- | --- |
| Work Order | `PDA-REL-WO-001` (PDF, 13/11/2026) |
| Repositório | `https://github.com/KayzenRoot/pedeoutra` |
| Branch | `feat/PDA-REL-WO-001-release-readiness` |
| PR | [#77](https://github.com/KayzenRoot/pedeoutra/pull/77) — **Draft, sem merge** |
| Base SHA | `203f91b64ad661cb4c707fa782c950e213701ec4` |
| Head de código | `fdc57e571a912e67b9196cd44b38e45b9fadd022` |
| Data | 2026-11-13 |
| Deploy de produção | `cf3b04be-039d-4f02-bc84-91644fa6246b` / `203f91b` |
| URL | https://pedeoutra.pages.dev |

Este bundle é o estado atual da release. O bundle anterior
(`PDA-MVP-WO-001.md`) é histórico do MVP.

## 2. Preflight e Source Check

- `git status --short` limpo antes da branch; `main` em `203f91b`.
- Branch de release criada a partir de `main`; `main` não foi modificada.
- PRs #12–#16 mescladas; issues #1–#11 fechadas; issues #17–#23 abertas.
- Docs lidos: checkpoint, ADRs, scope, DoD, architecture, requirements,
  security, test-plan, deployment, backlog, context-lock, README e evidence.
- Context Lock regenerado para `PDA-REL-WO-001`, base/head `203f91b`, 113
  arquivos.
- Baseline: `npm ci`, lint, typecheck, unit, build — todos exit 0.
- `main` agora tem ruleset ativo `main-release-protection` (id `27211431`).

## 3. Status das issues #17–#23

| Issue | Status | Evidência / razão |
| --- | --- | --- |
| #17 E-mail/recuperação | **BLOCKED (SMTP_BLOCKED)** | Redirects e fluxo de recuperação validados via link Admin; primeiro uso troca a senha, reuso e acesso direto são rejeitados. SMTP não configurado (`mailer_autoconfirm=true`, campos SMTP vazios); envio real não homologado. |
| #18 Billing HIGH_ASSURANCE | **DONE (integridade) / GO_LIVE_BLOCKED (cobrança real)** | 26 testes unitários de billing, DB duplicado, E2E local com Asaas mock; checkout de produção 201 sem pagamento; webhook de produção recebeu `CHECKOUT_CREATED`; nenhum pagamento real. |
| #19 Backup/ADR Supabase | **BLOCKED (decisão/custo)** | `test:restore` PASS com contagens/checksums; projeto Free/Ohio sem backups (`backups=[]`, `pitr_enabled=false`); ADR-009 PROPOSED com custos/RPO/RTO. Sem aceite, backup de produção BLOCKED. |
| #20 Legal/suporte | **BLOCKED (contato/revisão)** | Termos alinhados a cancelamento/reembolso; runbook LGPD/suporte criado; não há canal oficial aprovado nem revisão jurídica. Nenhum contato fictício publicado. |
| #21 Proteção/scanners | **DONE** | Ruleset ativo (PR obrigatório, 4 checks, sem bypass/force-push); auditoria de dependências 0 HIGH/CRITICAL; 9 moderados documentados; varredura de segredos/PII limpa; SonarCloud/Socket verdes no PR. |
| #22 Smoke/observabilidade | **DONE (rollback não executado)** | URL/headers/asset conferem com `203f91b`/`cf3b04be`; smoke dois usuários PASS; health Pages/Auth/webhook/reconcile PASS; `release-health` preparado; rollback documentado e deployment anterior inventariado, sem ensaio destrutivo. |
| #23 Evidence/PR Draft | **DONE** | Este bundle, Context Lock, Checkpoint Delta PROPOSED e PR #77 Draft. |

## 4. Comandos e resultados

Logs em `evidence/logs/pda-rel-final-*.log` e logs direcionados.

| Comando | Resultado | Exit |
| --- | --- | --- |
| `npm ci` | instalação limpa | 0 |
| `npm run lint` | ESLint sem erros | 0 |
| `npm run typecheck` | app + config | 0 |
| `npm run test:unit` | **78 PASS / 0 FAIL** em 10 arquivos | 0 |
| `npm run build` | JS 495,54 kB (gzip 141,04 kB) | 0 |
| `npm run test:db` | 30 PASS / 0 FAIL | 0 |
| `npm run test:postgrest` | 13 PASS / 0 FAIL | 0 |
| `npm run test:edge` | 11 Edge Functions typechecked | 0 |
| `npm run test:edge-http` | 17 PASS / 0 FAIL | 0 |
| `npm run test:full-local` | 7 PASS / 0 FAIL | 0 |
| `npm run test:restore` | contagens/checksums idênticos | 0 |
| `npm run smoke:preview` | axe 0 serious/critical; rotas legais/404 | 0 |

CI do PR #77 no HEAD `fdc57e5`:

- push run [43463201013](https://github.com/KayzenRoot/pedeoutra/actions/runs/43463201013) — 4/4 jobs verdes.
- pull_request run [43463212812](https://github.com/KayzenRoot/pedeoutra/actions/runs/43463212812) — 4/4 jobs verdes.
- commit de evidência `20f5e8d`: push run [43464324447](https://github.com/KayzenRoot/pedeoutra/actions/runs/43464324447)
  e PR run [43464339392](https://github.com/KayzenRoot/pedeoutra/actions/runs/43464339392)
  — 4/4 jobs verdes em ambos.
- SonarCloud e Socket: pass.

## 5. Auth, SMTP e recuperação

- Supabase Auth `site_url=https://pedeoutra.pages.dev`; allow-list inclui
  `/redefinir-senha` em produção e localhost.
- `mailer_autoconfirm=true`; `smtp_host/user/pass/sender` ausentes.
- Estado: **SMTP_BLOCKED**. Nenhum e-mail real foi enviado.
- Validação via link de recuperação Admin:
  - primeiro uso autentica a sessão de recuperação e troca a senha;
  - reuso do mesmo link é rejeitado de forma neutra;
  - acesso direto a `/redefinir-senha` sem sessão é rejeitado.
- `signUp` agora envia `emailRedirectTo=/entrar` para quando o SMTP for
  habilitado.
- 3 testes de componente + 3 testes de `safeInternalPath` cobrem mensagens
  genéricas, senhas divergentes e open redirect.

## 6. Billing e produção

- Plano 2990 centavos, ciclo mensal, preço fixo no servidor.
- `successUrl` não ativa acesso; ativação exige evento validado no servidor.
- Testes: 26 unitários de billing, 30 DB/RLS, 17 Edge HTTP e 7 grupos E2E full.
- Produção:
  - `POST /functions/v1/create-checkout` → **201**;
  - host do link `www.asaas.com`; `price_cents=2990`; `cycle=MONTHLY`;
  - assinatura local `pending`, sem `provider_subscription_id`;
  - `CHECKOUT_CREATED` recebido pelo webhook e marcado `ignored`;
  - usuário/organização/assinatura/evento de teste removidos;
  - Asaas produção: **0 pagamentos, 0 assinaturas, 0 clientes**.
- **LIVE_CHARGE_NOT_APPROVED:** nenhuma cobrança real foi executada;
  `GO_LIVE_BLOCKED` para a primeira transação real.

## 7. Backup, restauração e RPO/RTO

- Projeto `waygtbclkxklexnabwvj`: `us-east-2`, `ACTIVE_HEALTHY`.
- Supabase Free: `pitr_enabled=false`, `backups=[]`; sem backup automático.
- `test:restore` prova dump/restore e checksums em ambiente isolado.
- Opções (ADR-009 PROPOSED):
  - Pro Ohio: US$ 25/mês, backup diário 7 dias, RPO até 24h, RTO estimado 1–2h.
  - PITR: +US$ 100/mês, RPO até 2 min, retenção 7 dias.
  - Free + export manual: RPO desde o último export, sem garantia.
  - `sa-east-1` disponível, mas exige migração e reconfiguração.
- **Backup de produção BLOCKED** até aceite formal de Pro/export ou waiver de
  risco; nenhum dado real foi destruído.

## 8. Legal, privacidade e suporte

- Termos agora explicitam teste de 7 dias, R$ 29,90/mês, cancelamento com acesso
  até o fim do período, reembolso revogando acesso e trial sem extensão.
- Privacidade removeu o repositório como canal público e mantém o aviso de que o
  canal oficial será publicado antes da venda.
- `docs/support-runbook.md` define suporte, LGPD, incidentes e retenção.
- **BLOCKED:** não há e-mail/URL oficial aprovado nem revisão jurídica humana;
  nenhum contato fictício foi inventado.

## 9. Deploy, operação e rollback

- Produção: commit `203f91b`, deployment `cf3b04be`, asset
  `assets/index-CXL0XUvt.js` idêntico ao build de `203f91b`; HTTP 200.
- Headers: CSP, HSTS via Cloudflare, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`.
- Cloudflare API de deployments oscilou com 503; `wrangler pages deployment
  list` confirmou o deployment e o branch `main`.
- Smoke dois usuários: cadastro, organização, dois produtos, catálogo mobile,
  pedido, confirmação/conclusão, cliente, recompra, dois pedidos e login em
  segundo navegador — PASS. Dados sintéticos removidos por ID/e-mail.
- Inventário: há **1 usuário/organização/produto/pedido real** no ambiente,
  identificado fora dos testes e preservado; nenhum cleanup global foi feito.
- Health: Pages 200, Auth 200, webhook com token inválido 401, reconcile 200.
- `main` ruleset `main-release-protection` (id `27211431`) ativo: PR obrigatório,
  4 checks, sem force-push/deleção/bypass; aprovação extra para commits não
  atribuídos desabilitada para preservar o fluxo solo.
- `release-health` foi adicionado ao PR para rodar a cada 6h; só fica ativo após
  merge. `keepalive` e `billing-reconcile` já existem na `main`.
- Rollback: deployment anterior `01656b3f` (`6328c49`) inventariado; ensaio
  destrutivo não executado. Rollback/roll-forward documentado em
  `docs/deployment.md`.

## 10. Matriz de proof obligations

| ID | Prova | Resultado |
| --- | --- | --- |
| PO-01 | Tenant A não lê/escreve B (DB/HTTP) | PASS — 30 DB/RLS + 13 PostgREST |
| PO-02 | Sem trial/assinatura válida não altera dados | PASS — DB tests |
| PO-03 | Callback/JS não libera acesso | PASS — billing tests/código |
| PO-04/05 | Pagamento não validado, adulterado, duplicado, outro tenant | PASS — billing tests + DB + E2E |
| PO-06/07 | Fora de ordem e reembolso não reativam | PASS — billing tests |
| PO-08 | Reprocessamento idempotente/auditável | PASS — DB duplicado + reconcile |
| PO-09 | Recuperação exige sessão/token válido; e-mail entregue | **PARCIAL/BLOCKED** — token/reuso PASS, entrega real SMTP_BLOCKED |
| PO-10 | Backup sintético restaura contagens/checksums/permissões | PASS — `test:restore`; produção BLOCKED |
| PO-11 | HEAD/CI/versão em produção | PASS para `main` `203f91b`/`cf3b04be`; PR #77 é Draft e não foi implantado por regra |
| PO-12 | Segredos/PII fora de código/logs | PASS — varredura limpa; audit 0 HIGH/CRITICAL |

## 11. Riscos e bloqueios remanescentes

1. **SMTP_BLOCKED:** sem credenciais, não há confirmação/recuperação real.
2. **Backup BLOCKED:** Free/Ohio sem backup; ADR-009 PROPOSED aguarda aceite de
   custo (Pro US$ 25/mês; PITR +US$ 100/mês).
3. **Legal/suporte BLOCKED:** contato oficial e revisão jurídica pendentes.
4. **Cobrança real:** não autorizada; `LIVE_CHARGE_NOT_APPROVED`.
5. **Alertas:** `release-health` só ativa após merge; notificações do GitHub
   precisam estar habilitadas no proprietário.
6. **Rollback:** procedimento documentado, não ensaiado de forma destrutiva.
7. **Supabase Free:** risco de pausa e ausência de backup; keepalive não é
   garantia.
8. 9 vulnerabilidades moderadas de dependências (0 HIGH/CRITICAL); React Router
   tem mitigação no `next` e advisory SSR não aplicável ao SPA.

## 12. Checkpoint Delta PROPOSED

- ADR-009 PROPOSED: backup/continuidade com Pro/Ohio antes do primeiro pagante.
- ADR-007 permanece APPROVED (Free/Ohio no lançamento); não foi sobrescrita.
- Status proposto: `APPROVED STAGING` / `COMMERCIAL_BLOCKED`.
- Sem promoção automática de ADR/checkpoint; sem merge.
- Próximos desbloqueios: SMTP, decisão ADR-009, suporte/legal, autorização da
  primeira cobrança real e auditoria independente.

## 13. Veredito

**VEREDITO: APPROVED STAGING / COMMERCIAL_BLOCKED.**

O software, os testes e o deploy de staging estão aprovados; não há falha
HIGH/CRITICAL conhecida. A venda pública permanece bloqueada por SMTP, backup
de produção, suporte/legal e ausência de autorização para a primeira cobrança
real. PR #77 permanece **Draft**, sem merge.
