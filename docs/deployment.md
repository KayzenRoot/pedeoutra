# Deployment

## Status desta WO

**Staging/sandbox: PASS.** Frontend em Cloudflare Pages com deploy automático
via GitHub, banco/funções em Supabase Cloud e cobrança em Asaas produção
configurada (Sandbox usado para testes) foram validados com dados sintéticos.
Os dados sintéticos de staging foram removidos em 13/11/2026; o ambiente começa
vazio para novos testes.
O PR #12 foi mesclado em `main` com autorização explícita (merge commit
`26d55e0`) e a produção do Pages foi apontada para `main`.

**Produção monetizada: CONFIGURADA, sem cobrança real.** A conta Asaas de
produção está aprovada; API key, checkout e webhook de produção foram
configurados e validados com um checkout de teste **sem pagamento**. A primeira
cobrança real ainda não foi executada e depende de autorização explícita,
domínio próprio, Supabase Pro/região e auditoria.

## Ambiente atual (staging)

| Item | Valor |
| --- | --- |
| Frontend | `https://pedeoutra.pages.dev` (Cloudflare Pages Git, projeto `pedeoutra`) |
| Repositório Pages | `KayzenRoot/pedeoutra`, branch de produção `main` |
| Build Pages | `npm run build`; output `dist`; Node 22; auto-deploy a cada push em `main` |
| Supabase | project ref `waygtbclkxklexnabwvj` (região East US/Ohio) |
| Migrations | 4 migrations aplicadas via `supabase db push` |
| Edge Functions | 11 publicadas; públicas com `--no-verify-jwt`, autenticadas com JWT |
| Auth | Site URL/redirects do Pages; `mailer_autoconfirm=true` no MVP |
| Asaas | Produção configurada (API key, checkout e webhook); Sandbox removido/limpo |
| Webhook Asaas produção | id `71177108-9a90-43be-92b3-a9cf91595169`, 13 eventos, `enabled=true` |
| Smoke | cadastro, organização, produto, catálogo, pedido, recompra, checkout de produção sem pagamento |

O webhook de produção aponta para
`https://waygtbclkxklexnabwvj.supabase.co/functions/v1/asaas-webhook` e usa o
header `asaas-access-token`. O token não é versionado. O webhook antigo do
Sandbox foi removido junto com a assinatura/cliente de teste.

O Supabase Free pode pausar por inatividade. O workflow
`.github/workflows/keepalive.yml` faz um ping diário em `/auth/v1/health` com a
chave anon para reduzir esse risco; ele depende do agendamento do GitHub e não
substitui o plano Pro. Revisar plano/limites antes de usuários pagantes.

### Decisão de região e plano (staging)

O staging permanece em **East US/Ohio** (`waygtbclkxklexnabwvj`) nesta fase:
não há usuários reais, o go-live comercial ainda está bloqueado e recriar o projeto
em São Paulo mudaria URL, chaves, secrets, Auth e webhook Asaas. A decisão está
registrada na ADR-007. Antes do go-live, migrar para `sa-east-1` e contratar
Supabase Pro são pré-requisitos, com janela, novo smoke e atualização de
`VITE_SUPABASE_*`, secrets das funções e webhook.

## Deploy automático do frontend

O projeto `pedeoutra` foi recriado como projeto Git do Cloudflare Pages. O
projeto antigo de upload direto não pode ser convertido (`source` imutável), e a
recriação manteve a URL pública `https://pedeoutra.pages.dev`. Após o merge do
PR #12, a branch de produção foi trocada para `main`; o build do merge commit
`26d55e0` gerou o deployment `c26319e5-4fac-4e8c-9c0b-e99d5149507d` com sucesso.
Builds são disparados por push em `main`; o build inicial foi
`8bf03fa3-316b-481b-ab8d-6b6a79a43d4d` (commit `564bc2d`), o auto-deploy foi
validado com `cdbceaf` (`40e745f0-60f8-4d43-a1de-76d82a513277`) e o último
build da branch foi `1fae02ae-141b-4ba5-82aa-ea2db7860418` (commit `2993e67`).

Variáveis configuradas em Production e Preview: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL` e `NODE_VERSION=22`. Nenhum segredo de
servidor (service role/Asaas) existe no Pages.

## Topologia alvo

| Componente | Serviço | Observação |
| --- | --- | --- |
| Frontend | Cloudflare Pages | SaaS comercial não deve usar Vercel Hobby |
| Auth/DB | Supabase Cloud | Free pode pausar por inatividade; revisar ao ter pagantes |
| Funções | Supabase Edge Functions | `service_role` só no servidor |
| Pagamento | Asaas Sandbox → Produção | somar assinatura do fornecedor apenas |
| CI | GitHub Actions | lint, typecheck, testes, build, RLS, Deno |

## Variáveis

### Frontend (Cloudflare Pages)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (chave anon; pública por design, protegida por RLS)
- `VITE_APP_URL` (URL pública do frontend)
- `VITE_ANALYTICS_ENDPOINT` (opcional; eventos sem PII)
- `NODE_VERSION=22` (build do Pages)

Nunca configurar `SUPABASE_SERVICE_ROLE_KEY`, `ASAAS_API_KEY` ou
`ASAAS_WEBHOOK_TOKEN` no frontend.

### Edge Functions (Supabase secrets)

- `APP_ORIGIN` (lista separada por vírgula)
- `ASAAS_API_KEY` (produção; nunca versionada)
- `ASAAS_API_BASE_URL` (`https://api.asaas.com`)
- `ASAAS_CHECKOUT_BASE_URL` (`https://www.asaas.com`)
- `ASAAS_WEBHOOK_TOKEN` (token exclusivo do webhook de produção)
- `ASAAS_WEBHOOK_ID` (`71177108-9a90-43be-92b3-a9cf91595169`, referência operacional)
- `BILLING_RECONCILE_TOKEN`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (injetadas pelo Supabase)

## Passos de deploy (quando autorizado)

1. Criar projeto Supabase e anotar `project-ref`.
2. `supabase link --project-ref <ref>`.
3. `supabase db push` (migrations versionadas; revisar dry-run).
4. `supabase secrets set --env-file supabase/functions/.env.production`.
5. Deploy das funções:
   - Autenticadas (JWT obrigatório): `create-checkout`, `cancel-subscription`,
     `reorder-create`, `reorder-revoke`, `link-order-customer`,
     `billing-reconcile`.
   - Públicas (`--no-verify-jwt`): `public-catalog`, `public-order`,
     `reorder-get`, `reorder-submit`, `asaas-webhook`.
6. Configurar no Asaas o webhook `https://<ref>.supabase.co/functions/v1/asaas-webhook`
   com o token exclusivo `ASAAS_WEBHOOK_TOKEN`.
7. Cloudflare Pages: conectar o repositório GitHub, branch de produção `main`,
   build `npm run build`, output `dist`, Node 22 e variáveis do frontend em
   Production/Preview.
8. Smoke com dados sintéticos:
   - cadastro + organização;
   - 5 produtos;
   - catálogo público em outro navegador/dispositivo;
   - pedido público;
   - link de recompra;
   - checkout sandbox e evento de webhook;
   - status de acesso.
9. Registrar URL, SHA do build, horário e resultados no Evidence Bundle.

## Checklist de produção Asaas

- [x] Conta Sandbox validada; conta de produção aprovada e configurada.
- [x] Webhook de produção com token forte/exclusivo; header `asaas-access-token`.
- [x] Preço 2990 centavos conferido no servidor (checkout de produção).
- [x] `successUrl` não ativa assinatura (código e testes).
- [x] Eventos duplicados/fora de ordem/reembolso testados em sandbox/mocks.
- [x] Nenhum dado de cartão trafega pelo PedeOutra.
- [ ] Primeira cobrança real controlada, com autorização explícita.
- [x] Reconciliador agendado (cron) com token próprio — workflow `billing-reconcile` diário.
- [ ] Plano de rollback e contato de suporte definidos.
- [ ] Domínio próprio + Supabase Pro/migração para `sa-east-1`.

## Rollback

1. Frontend: promover o deployment anterior no Cloudflare Pages ou reverter o
   commit na branch de produção; o push seguinte reconstrói automaticamente.
2. Funções: redeploy da versão anterior; manter migrations compatíveis.
3. Banco: migrations são aditivas nesta versão; restaurar backup verificado se
   houver mudança destrutiva.
4. Billing: pausar webhook no Asaas antes de reverter funções; reconciliar
   eventos pendentes após o rollback.

## Limites e riscos

- Supabase Free pode pausar; o keepalive diário mitiga, mas o Pro é obrigatório
  antes de usuários pagantes. O staging segue em East US/Ohio por decisão
  registrada (ADR-007); a migração para `sa-east-1` é pré-requisito do go-live.
- Cloudflare Pages deve ser verificado para uso comercial no momento do deploy.
- A produção Asaas está configurada e validada sem cobrança. A primeira cobrança
  real, o domínio próprio, o Supabase Pro/migração e a auditoria independente
  continuam pendentes; nada disso deve ser tratado como go-live automático.
