# Programa de indicações — modo seguro (#56)

## Estado

Implementado em **modo sem custeio**. Uma indicação pode ser registrada,
qualificada por primeiro pagamento confirmado e auditada, mas a recompensa fica
**pendente**. Nenhum crédito, desconto, cancelamento ou chamada ao Asaas é
executado por este fluxo.

A ativação financeira (mês grátis, crédito, desconto ou qualquer efeito em
cobrança) exige:

1. ADR específico com definição do benefício.
2. Simulação de custo e compatibilidade Asaas.
3. Aprovação explícita do proprietário.
4. Novo caminho de concessão idempotente e testado em mocks antes de campanha.

Sem esses passos, o estado correto é `reward_pending` com valor nulo.

## Fluxo

1. O owner acessa Configurações → “Indique outros fornecedores”.
2. O servidor cria um código opaco de 24 hex (`referral_codes`), com limite
   padrão de 25 usos e expiração em 180 dias. Um novo link revoga o anterior.
3. O link é `/criar-conta?ref=<código>`. O código é guardado apenas na sessão do
   navegador até a criação da organização.
4. No onboarding, `api_referral_attribute` valida código, expiração, limite,
   autoindicação e telefone comercial idêntico. A primeira atribuição válida
   vence; tentativas posteriores não sobrescrevem.
5. A indicação nasce `signed_up`; o indicado não vê quem o indicou.
6. O webhook Asaas, após validar um `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` real,
   chama `api_referral_qualify`. Trial, clique, `successUrl` e evento simulado
   não qualificam.
7. A qualificação cria uma linha única em `reward_ledger` com status `pending`,
   valor nulo e aviso de aprovação financeira.
8. `PAYMENT_REFUNDED` chama `api_referral_reverse`; a recompensa pendente vira
   `reversed`. Admin também pode reverter manualmente com motivo.

## Antifraude e privacidade

- Autoindicação: bloqueada e registrada em `referral_events` como
  `self_referral`, sem criar recompensa.
- Telefone comercial idêntico ao do indicador: indicação marcada
  `review_required`, status `rejected`, flag `same_phone`, sem recompensa.
- Não há bloqueio definitivo baseado apenas em IP; nenhum dado de cartão é
  coletado.
- O indicado nunca recebe nome, e-mail, telefone ou organização do indicador.
- O owner vê apenas rótulos neutros (`Indicação <id curto>`) e status.
- Eventos e flags ficam fora do browser; acesso direto às tabelas é revogado.
- Código é aleatório (96 bits), único e armazenado apenas na tabela protegida;
  não é sequencial e não aparece em logs/analytics.

## Status

`invited | signed_up | trial | qualified | reward_pending | reward_granted | rejected | reversed`

No modo atual, `reward_granted` não é atingido automaticamente. Admin pode
reverter; conceder exige aprovação financeira futura.

## Administração

- `admin-api?view=referrals` lista indicações com indicador, indicado, status,
  flags, recompensa e datas.
- `POST admin-api` com `action=referral.reverse`, `referral_id` e motivo de 5 a
  500 caracteres.
- A reversão grava `referral_events` e `platform_audit_events`
  (`referral.reversed`), marca o ledger como `reversed` e **não** altera Asaas.
- Acesso exige admin de plataforma + AAL2, como o restante do console.

## Tabelas e RPCs

- Tabelas: `referral_codes`, `referrals`, `reward_ledger`, `referral_events`.
- Owner: `api_referral_code_get_or_create`, `api_referral_code_rotate`,
  `api_referral_code_revoke`, `api_referral_list`.
- Cadastro: `api_referral_attribute`.
- Billing/admin: `api_referral_qualify`, `api_referral_reverse`,
  `api_admin_referrals`, `api_admin_referral_reverse` (service_role).
- Idempotência: `referrals.idempotency_key`, unicidade por organização indicada
  e por usuário indicado, `reward_ledger.referral_id` único.

## Testes

- DB: autoindicação, primeira atribuição, duplicidade, mesmo telefone, limite de
  usos, rotação, expiração, qualificação única, ledger pendente, reversão,
  isolamento e auditoria admin.
- Edge HTTP: `admin-api` lista e reverte sem efeito financeiro.
- Unit: painel mostra link, status e “pendente de aprovação”; rotação revoga o
  código anterior.
