# Ativação da Parte 1 — runbook e registro (executado)

Status: **EXECUTADO EM 2026-11-13**. As migrations, Edge Functions, secrets e
merge foram aplicados com autorização do proprietário. O bootstrap do
superadmin permanece pendente de TOTP/AAL2. Este documento fica como runbook de
rollback/roll-forward e repetição controlada.

## Estado pré-ativação verificado em 2026-11-13

`supabase migration list --linked` mostrou 4 migrations aplicadas no projeto
`waygtbclkxklexnabwvj` e **2 pendentes**:

```text
20261113000100_plans_entitlements.sql   (local, sem remote)
20261113000200_admin_trial.sql          (local, sem remote)
```

`supabase db push --linked --dry-run` confirmou que apenas essas duas seriam
aplicadas, sem erro:

```text
DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20261113000100_plans_entitlements.sql
 • 20261113000200_admin_trial.sql
```

O staging continua no build da release (`index-Dcy9tgpI.js`); a Parte 1 não foi
publicada.

## Pré-requisitos obrigatórios

1. Auditoria e aceite explícito da PR #89 pelo proprietário.
2. Autorização específica para migrar o banco de produção e publicar as Edge
   Functions/frontend.
3. Decisão de backup/continuidade: o Supabase Free/Ohio **não tem backup
   automático**. Antes do `db push`, exportar schema+dados ou aceitar
   formalmente o risco (ADR-009/waiver). Sem isso, a ativação permanece
   `BACKUP_BLOCKED`.
4. `ADMIN_EMAIL` e `ADMIN_BOOTSTRAP_TOKEN` definidos pelo proprietário, fora do
   repositório.
5. Janela sem cobrança real; a primeira cobrança continua exigindo autorização
   separada.

## Ordem de ativação

### 1. Exportação / ponto de retorno

```bash
supabase db dump --linked -f backup_pre_v2.sql
supabase db dump --linked --data-only -f backup_pre_v2_data.sql
```

Guardar os arquivos fora do repositório e verificar o tamanho. Em Free, isso é
um export manual, não um backup contínuo.

### 2. Migrations

```bash
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Esperado: as duas migrations V2 passam a aparecer com Remote preenchido. As
migrations são aditivas; não há backfill de cobrança, e-mail ou chamada Asaas.

### 3. Edge Functions

Publicar as novas:

```bash
supabase functions deploy plan-catalog --no-verify-jwt
supabase functions deploy admin-api
supabase functions deploy admin-bootstrap
supabase functions deploy change-plan
```

Redeployar as que compartilham `_shared/billing.ts`/`billing-processor.ts`:

```bash
supabase functions deploy create-checkout
supabase functions deploy cancel-subscription
supabase functions deploy asaas-webhook --no-verify-jwt
supabase functions deploy billing-reconcile
```

### 4. Secrets de Edge Function

```bash
supabase secrets set ADMIN_EMAIL="<email-do-proprietario>"
supabase secrets set ADMIN_BOOTSTRAP_TOKEN="<token-aleatorio-forte>"
supabase secrets set PRO_PLAN_CHECKOUT_ENABLED=false
supabase secrets set PLAN_CHANGE_MODE=disabled
```

Não configurar `PRO_PLAN_CHECKOUT_ENABLED=true` antes da Parte 2/4. O token de
bootstrap é one-time e não deve ir para o repositório, logs ou screenshots.

### 5. Bootstrap do superadmin

Pré-condição: o usuário do `ADMIN_EMAIL` já existe no Auth e tem TOTP verificado
(AAL2). O console permanece fechado até isso.

```bash
curl -X POST "https://waygtbclkxklexnabwvj.supabase.co/functions/v1/admin-bootstrap" \
  -H "Authorization: Bearer <access-token-AAL2>" \
  -H "x-admin-bootstrap-token: $ADMIN_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Esperado: `201` com `bootstrapped=true`; depois, `/admin` responde com dados
somente para esse UUID + AAL2. Sem `ADMIN_EMAIL`, a resposta é `503
ADMIN_BOOTSTRAP_BLOCKED`.

### 6. Frontend

Após merge autorizado da PR #89, o Cloudflare Pages publica `main`
automaticamente. Verificar:

- `https://pedeoutra.pages.dev/` 200 e assets novos;
- `/app/assinatura` carrega os dois planos via `plan-catalog`, com Profissional
  “Em preparação” e botão desabilitado;
- `/app/configuracoes` carrega dados reais, tema e limites;
- `/admin` falha fechado para não-admin/AAL1 e abre para o superadmin AAL2;
- nenhuma cobrança é iniciada; nenhum e-mail é enviado.

### 7. Rollback / roll-forward

- Frontend: promover o deployment anterior no Cloudflare Pages.
- Edge: redeploy da versão anterior; não reverter o banco para evitar perda de
  dados. As colunas/tabelas V2 são aditivas e podem permanecer.
- Se o billing for revertido, pausar o webhook no Asaas antes e reconciliar
  eventos pendentes depois.
- Não dropar `plan_catalog`, `trial_grants`, `platform_admins` ou
  `plan_changes` com dados reais sem export e autorização.

## O que este runbook não autoriza

- Cobrança real, upgrade/downgrade automático, compra de Supabase Pro/PITR.
- Envio de e-mail, convites de equipe ou WhatsApp oficial.
- Publicação de anúncio, Meta Ads ou API Profissional.
- Merge da PR #89 ou deploy sem autorização específica.
