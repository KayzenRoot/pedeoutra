# PedeOutra V2 — dry-run de migrations sobre clone de produção

Data: 2026-11-16
Branch/PR: `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp` / PR #90 (Ready for review)
Status: **PASS** — nenhuma alteração em produção.

## Objetivo

Validar as 19 migrations novas contra um clone local dos dados reais de
produção antes de qualquer deploy. O teste é read-only na origem: schema e dados
foram exportados com `supabase db dump --linked` e restaurados em Postgres 17
isolado. Nenhum dump, credencial ou dado real foi versionado.

## Execução

1. Dump de schema público, schema `auth` e dados de produção.
2. Container Postgres 17 isolado (`pedeoutra-prod-dry`), sem acesso à produção
   após o dump.
3. Restauração de `auth`, schema público e dados; criação das roles/schemas
   gerenciados pelo Supabase necessários ao clone (`extensions`,
   `supabase_realtime`; extensão `supabase_vault` indisponível no Postgres
   vanilla foi omitida apenas no clone).
4. Aplicação das 19 migrations novas em ordem, com `ON_ERROR_STOP=1`.
5. Sanidade de dados e RPCs novas com o usuário/organização reais do clone
   (plano elevado apenas dentro de transação com `ROLLBACK`).

## Resultado

- **19/19 migrations aplicadas sem erro.**
- Dados reais preservados no clone: `organizations=1`, `products=1`, `orders=1`,
  `users=1`, `subscriptions=1`, `platform_admins=1`.
- Tabelas novas de indicação criadas e vazias (`referral_codes=0`,
  `referrals=0`, `reward_ledger=0`, `referral_events=0`).
- RPCs novas presentes:
  `api_customer_insights`, `api_customer_insights_summary`,
  `api_customer_order_history`, `api_referral_code_get_or_create`,
  `api_referral_attribute`, `api_referral_qualify`, `api_referral_reverse`,
  `api_admin_referrals`, `api_admin_referral_reverse`.
- Chamada autenticada no clone: resumo do relatório retornou 1 linha; lista de
  insights retornou 0 (não há clientes sintéticos no clone); geração de código
  de indicação retornou 24 caracteres. Transação revertida.
- Nenhuma cobrança, e-mail, WhatsApp, crédito ou deploy.

## Limitações do dry-run

- O clone não contém os schemas internos completos do Supabase (Storage,
  Realtime, Vault); a extensão `supabase_vault` foi omitida no clone. Nenhuma
  migration nova depende dela.
- O dump é um retrato do momento; o deploy real deve refazer backup e
  verificação imediatamente antes da janela.
- A validação de Edge Functions em produção continua dependendo de deploy
  autorizado; o typecheck e os testes HTTP locais já estão verdes.

## Conclusão

O clone de produção aceita todas as migrations e as RPCs novas sem conflito com
os dados reais. O deploy segue **BLOCKED_AUTHORIZATION** até autorização
explícita e backup verificado na janela (`docs/deployment.md`).
