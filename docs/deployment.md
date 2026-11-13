# Deployment

## Status desta WO

**Staging/sandbox: PASS.** Frontend em Cloudflare Pages com deploy automático
via GitHub, banco/funções em Supabase Cloud e cobrança em Asaas Sandbox foram
configurados e validados com dados sintéticos. Os dados sintéticos de staging
foram removidos em 13/11/2026; o ambiente começa vazio para novos testes.

**Produção monetizada: BLOCKED.** Ainda faltam credenciais/checkout Asaas de
produção, domínio próprio e auditoria independente. Nenhuma cobrança real foi
executada.

## Ambiente atual (staging)

| Item | Valor |
| --- | --- |
| Frontend | `https://pedeoutra.pages.dev` (Cloudflare Pages Git, projeto `pedeoutra`) |
| Repositório Pages | `KayzenRoot/pedeoutra`, branch de produção `feat/PDA-MVP-WO-001-pedeoutra-mvp` até o merge |
| Build Pages | `npm run build`; output `dist`; Node 22; auto-deploy a cada push na branch |
| Supabase | project ref `waygtbclkxklexnabwvj` (região East US/Ohio) |
| Migrations | 4 migrations aplicadas via `supabase db push` |
| Edge Functions | 11 publicadas; públicas com `--no-verify-jwt`, autenticadas com JWT |
| Auth | Site URL/redirects do Pages; `mailer_autoconfirm=true` no MVP |
| Asaas | Sandbox; checkout hospedado e webhook autenticado ativos |
| Smoke | cadastro, organização, produto, catálogo, pedido, recompra e assinatura ativa |

O webhook Asaas aponta para
`https://waygtbclkxklexnabwvj.supabase.co/functions/v1/asaas-webhook` e usa o
header `asaas-access-token`. O token não é versionado.

O Supabase Free pode pausar por inatividade. Revisar plano/limites antes de
usuários pagantes. A região East US foi a recomendada pelo painel; uma migração
para São Paulo exigiria recriar o projeto.

## Deploy automático do frontend

O projeto `pedeoutra` foi recriado como projeto Git do Cloudflare Pages. O
projeto antigo de upload direto não pode ser convertido (`source` imutável), e a
recriação manteve a URL pública `https://pedeoutra.pages.dev`. A branch de
produção é a branch da WO até o merge; depois deve ser trocada para `main` em
Settings → Build → Production branch. Builds são disparados por push; o build
inicial foi `8bf03fa3-316b-481b-ab8d-6b6a79a43d4d` (commit `564bc2d`), o
auto-deploy foi validado com o push `cdbceaf` (deployment
`40e745f0-60f8-4d43-a1de-76d82a513277`) e o build final de código/teste foi
`1fae02ae-141b-4ba5-82aa-ea2db7860418` (commit `2993e67`), todos com sucesso.

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
- `ASAAS_API_KEY`
- `ASAAS_API_BASE_URL` (`https://api-sandbox.asaas.com` ou produção)
- `ASAAS_CHECKOUT_BASE_URL` (`https://sandbox.asaas.com` ou produção)
- `ASAAS_WEBHOOK_TOKEN`
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
7. Cloudflare Pages: conectar o repositório GitHub, branch de produção
   (temporariamente a branch da WO; `main` após o merge), build `npm run build`,
   output `dist`, Node 22 e variáveis do frontend em Production/Preview.
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

- [ ] Conta sandbox validada; depois produção com aprovação explícita.
- [ ] Webhook com token forte e exclusivo; header `asaas-access-token`.
- [ ] Preço 2990 centavos conferido no servidor.
- [ ] `successUrl` não ativa assinatura.
- [ ] Eventos duplicados/fora de ordem/reembolso testados.
- [ ] Nenhum dado de cartão trafega pelo PedeOutra.
- [ ] Reconciliador agendado (cron) com token próprio.
- [ ] Plano de rollback e contato de suporte definidos.

## Rollback

1. Frontend: promover o deployment anterior no Cloudflare Pages ou reverter o
   commit na branch de produção; o push seguinte reconstrói automaticamente.
2. Funções: redeploy da versão anterior; manter migrations compatíveis.
3. Banco: migrations são aditivas nesta versão; restaurar backup verificado se
   houver mudança destrutiva.
4. Billing: pausar webhook no Asaas antes de reverter funções; reconciliar
   eventos pendentes após o rollback.

## Limites e riscos

- Supabase Free pode pausar; documentar upgrade antes de usuários pagantes.
- Cloudflare Pages deve ser verificado para uso comercial no momento do deploy.
- Sem credenciais, os passos acima permanecem `BLOCKED`, não `DONE`.
