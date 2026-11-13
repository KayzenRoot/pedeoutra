# Scope

## Dentro do MVP (PDA-001 a PDA-011)

- Landing comercial e onboarding curto.
- Auth, uma organização por conta, trial de 7 dias.
- Produtos e clientes básicos.
- Catálogo público por fornecedor e pedido sem conta.
- Link de recompra opaco, revogável, com TTL.
- Painel de pedidos, transições de status e WhatsApp manual.
- Assinatura única R$ 29,90/mês via Asaas Checkout (sandbox).
- Webhook idempotente, reconciliação e estados de acesso.
- RLS multi-tenant, testes críticos, CI, Evidence Bundle e PR Draft.
- Deploy documentado e executado apenas se houver credenciais autorizadas.

## Fora do MVP

Integração oficial WhatsApp, mensagens automáticas, Pix dos pedidos, importação
CSV, preço por cliente, múltiplos funcionários, entregas, ERP, IA, PWA offline,
app nativo, descontos, relatórios avançados, estoque, nota fiscal, marketplace,
logística e gateway de pagamento dos pedidos B2B.

## Bloqueios explícitos

- Sem cobrança real, webhook de produção ou go-live monetizado sem conta de
  pagamento autorizada.
- Sem publicação de secrets.
- Sem declarar `DEPLOYED` sem URL e smoke reais.
- Sem merge automático.
- Sem inferir que marca/domínio estão liberados.
- Sem criar outro repositório: o canônico é `KayzenRoot/pedeoutra`.

## Critério de corte

Se o prazo apertar, reduzir apenas escopo periférico. Nunca reduzir isolamento
tenant, integridade de pedidos ou segurança da cobrança.
