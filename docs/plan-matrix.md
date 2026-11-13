# Matriz comercial — Essencial e Profissional (PROPOSED)

Status: `PROPOSED` — a matriz só se torna `APPROVED` após auditoria da Parte 1.
Fonte de verdade em runtime: `plan_catalog` + `plan_feature_entitlements`
(migrations). Preço, moeda, versão e limites nunca vêm do navegador.

## Planos e preços

| Campo | Essencial | Profissional |
| --- | --- | --- |
| `plan_code` | `essential` | `professional` |
| Preço mensal | 2990 centavos BRL (R$ 29,90) | 6990 centavos BRL (R$ 69,90) |
| Ciclo | mensal | mensal |
| Trial sem cartão | 7 dias | não há trial Profissional |
| Checkout nesta fase | habilitado (contrato existente) | **desativado por flag** até a Parte 2/4 |

## Recursos e feature keys

`enabled` indica se o plano concede a feature key. Recursos marcados como
"Parte 2/3/4" existem apenas como contrato: não são implementados, vendidos nem
exibidos como ativos nesta fase.

| Feature key | Essencial | Profissional | Limite | Disponibilidade real |
| --- | --- | --- | --- | --- |
| `catalog_public` | sim | sim | — | MVP |
| `products` | sim | sim | — | MVP |
| `customers` | sim | sim | — | MVP |
| `orders` | sim | sim | — | MVP |
| `order_tracking_link` | sim | sim | — | MVP |
| `reorder_manual` | sim | sim | — | MVP |
| `whatsapp_manual` | sim | sim | — | MVP (clique humano) |
| `dashboard_basic` | sim | sim | — | MVP |
| `import_csv` | sim | sim | — | Parte 2 |
| `pdf_nonfiscal` | sim | sim | — | Parte 2 |
| `qr_code` | sim | sim | — | Parte 2 |
| `onboarding_templates` | sim | sim | — | Parte 2 |
| `sku_quick_order` | sim | sim | — | Parte 2 |
| `order_minimum` | sim | sim | — | Parte 2 |
| `referrals` | sim | sim | — | Parte 3; recompensa monetária depende de regra aprovada |
| `private_prices` | não | sim | — | Parte 2 |
| `quotes` | não | sim | — | Parte 2 |
| `reorder_radar` | não | sim | — | Parte 3 |
| `inactive_customers` | não | sim | — | Parte 3 |
| `whatsapp_automation` | não | sim | — | Parte 2; custo/conta do fornecedor |
| `team` | não | sim | 3 usuários totais (1 owner + 2) | Parte 2/3 |
| `api_access` | não | sim | 10.000 req/mês por organização | Parte 4 |
| `api_rate` | não | sim | 60 req/minuto | Parte 4 |
| `api_keys` | não | sim | 3 chaves ativas | Parte 4 |

## Exclusivo da operadora (nunca de plano)

`meta_ads_admin`, `growth_center` e `financial_dashboard` pertencem ao
superadmin PedeOutra (UUID + AAL2) e não são concedidos a Essencial nem a
Profissional.

## Regras

1. Trial vigente concede apenas features `essential`.
2. Profissional exige pagamento de 6990 confirmado e reconciliado; pagamento de
   2990 jamais libera Profissional.
3. Downgrade/expiração bloqueia novas ações premium, mas preserva leitura do
   histórico e não apaga registros.
4. Quotas são atômicas, por tenant, medidas no servidor e auditáveis.
5. Não há plano anual, split, plano customizado ou limite retroativo de catálogo
   nesta versão.
