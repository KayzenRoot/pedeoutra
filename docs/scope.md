# Scope

## Dentro do MVP (PDA-001 a PDA-011)

- Landing comercial e onboarding curto.
- Auth, uma organização por conta, trial de 7 dias.
- Produtos e clientes básicos.
- Catálogo público por fornecedor e pedido sem conta.
- Link de recompra opaco, revogável, com TTL.
- Painel de pedidos, transições de status e WhatsApp manual.
- Assinatura única R$ 29,90/mês via Asaas Checkout (produção configurada; Sandbox para testes).
- Webhook idempotente, reconciliação e estados de acesso.
- RLS multi-tenant, testes críticos, CI, Evidence Bundle e PR revisável.
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

## Delta V2 — Parte 1/5 (PROPOSED, 2026-11-13)

Esta seção não substitui o MVP aprovado; registra o delta em planejamento.

- **Dentro da Parte 1:** tema claro/escuro/system; superadmin único por UUID
  com MFA AAL2 e console `/admin` fail-closed; trial de 7 dias idempotente por
  identidade e revisão proporcional; catálogo comercial com exatamente dois
  planos (`essential` 2990 centavos e `professional` 6990 centavos); motor de
  entitlements/quotas no servidor; configurações de conta; contratos de
  cobrança por plano sem cobrança real.
- **Contratos preparados, funcionalidade não entregue:** API Profissional
  (#64–#67), Meta Ads (#68–#71), WhatsApp oficial (#29–#31), preços privados e
  orçamentos (#48/#51), equipe (#58), Central de Crescimento (#34–#42),
  dashboard 360° (#78–#80) e SEO/landing final (#73–#76/#82–#83). Essas partes
  apenas consomem as feature keys; não são ativadas nesta fase.
- **Fora da Parte 1:** cobrança real, upgrade/downgrade automático no Asaas sem
  caminho comprovado, contratação de serviço pago, envio de e-mail real,
  publicação de anúncio, segundo administrador e qualquer recurso Pro vendido
  como disponível antes de implementação/teste/deploy.
- **Estado comercial:** Profissional permanece com checkout desativado e
  comunicação de "em preparação"; Essencial mantém o preço legado de R$ 29,90.
  Nada nesta seção autoriza go-live comercial, que segue bloqueado por SMTP,
  backup, suporte/legal e primeira cobrança.

## Delta V2 — Parte 2/5 (PROPOSED)

- **Dentro:** categorias e fotos de produto (#52), SKU/pedido rápido (#47),
  mínimos/múltiplos (#49), importação CSV/XLSX (#46), templates (#57), QR
  (#53), acompanhamento por token (#50), preços por comprador (#48),
  orçamentos (#51), PDF não fiscal (#55), equipe/RBAC (#58), contrato de
  conexão WhatsApp (#29–#31) e páginas comerciais (#63).
- **Bloqueado por dependência externa:** WhatsApp oficial só com WABA,
  templates e consentimento aprovados; convites de equipe dependem de SMTP;
  envio automático permanece desligado por padrão.
- **Fora:** API Profissional/Meta Ads/finanças (Parte 4), SEO/landing final
  (Parte 5), ERP, estoque, nota fiscal e cobrança de pedidos B2B.
