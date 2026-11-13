# Security

## Controles não negociáveis

### Multi-tenant

- RLS habilitada em todas as tabelas de negócio; default deny.
- `organizations` só é visível/atualizável pelo `owner_user_id = auth.uid()`.
- Produtos, clientes, pedidos, itens, links, assinatura e auditoria usam
  `app.is_org_owner(organization_id)`.
- Escritas exigem `app.org_can_write(organization_id)` (trial vigente ou
  assinatura válida), verificada no banco.
- Testes SQL A/B provam que forjar `organization_id` não cruza tenant.

### APIs públicas

- Não há grant para `anon` em tabelas. Catálogo e pedido passam por Edge
  Functions com `service_role` apenas no servidor.
- Catálogo devolve somente nome público, cidade, WhatsApp comercial e produtos
  ativos (nome, unidade, preço). Nunca clientes, pedidos ou histórico.
- Pedido público valida tamanho, quantidade, produto ativo do tenant correto e
  calcula total no banco; preço enviado pelo cliente é ignorado.
- Rate limit atômico em `app.consume_rate_limit` (bucket = hash de IP/escopo).
  O IP prioriza `cf-connecting-ip` e `x-real-ip` da borda; `x-forwarded-for` é
  fallback pelo último salto. Em self-hosting, a borda deve sobrescrever headers.
- Honeypot e tempo mínimo de formulário como barreira adicional; limites de
  50 itens, quantidade 1..999, nome/telefone/observação com tamanho máximo.

### Tokens de recompra

- 32 bytes de CSPRNG, base64url; apenas SHA-256 armazenado.
- TTL de 60 dias, revogação, `last_used_at`, rate limit por token e por IP.
- Token não entra em log, analytics ou query string de terceiros;
  `Referrer-Policy: no-referrer` e `noindex` nas páginas de recompra.
- Link inválido/expirado/revogado responde de forma neutra e oferece o catálogo.
- A página não recebe nome, telefone, endereço ou histórico do cliente.

### Sessão e autorização

- JWT validado pelo Supabase; nunca se confia em `auth.uid` vindo do payload do
  cliente nem em `organization_id` enviado como prova.
- Edge Functions autenticadas verificam o usuário e a organização no servidor.
- `service_role` só existe no ambiente das funções; nunca no bundle.

### Billing

- Plano e preço fixados no servidor (R$ 29,90 = 2990 centavos).
- `successUrl` é informativa; não ativa assinatura.
- Reembolso revoga o acesso pago. Um trial ainda vigente continua até seu fim,
  sem extensão; depois dele, a escrita é bloqueada.
- Webhook exige `asaas-access-token` em tempo constante; evento persistido com
  `provider_event_id UNIQUE` antes de processar.
- Validação de valor, moeda, tenant, assinatura e estado no provedor.
- Evento atrasado/fora de ordem não reativa assinatura; reembolso revoga acesso.
- Logs redigidos; nenhum token de pagamento em resposta pública.

### Web

- Smoke de acessibilidade com axe (WCAG 2 A/AA) em landing e demo, desktop e mobile.
- CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy:
  no-referrer`, `Permissions-Policy` mínima em `public/_headers`.
- Nenhum `dangerouslySetInnerHTML`; textos escapados pelo React.
- Analytics opcional envia apenas nome do evento e rota, sem PII, query string
  ou token; desativado por padrão.

### Release e supply chain

- `main` protegida por ruleset: PR obrigatório, checks de CI obrigatórios,
  sem force-push/deleção e sem bypass.
- `npm audit`: 0 HIGH/CRITICAL no runtime; 9 moderados transitivos/dev
  documentados. O open redirect do React Router é mitigado por
  `safeInternalPath` no parâmetro `next`; o advisory de SSR não se aplica ao SPA.
- `vitest` atualizado para 5.1.0, removendo o critical de `tinypool` no
  ambiente de testes.
- Varredura de padrões de segredo/PII em arquivos versionados sem achados.
- `release-health` (quando ativo na `main`) verifica Pages, Auth, webhook e
  reconciliador a cada 6h.

### LGPD

- Minimização: nome comercial/telefone apenas quando necessário; observação
  livre limitada a 500 caracteres.
- Aviso de privacidade e consentimento simples no envio do pedido.
- Retenção operacional padrão: pedidos e clientes enquanto a conta existir;
  exclusão manual mediante solicitação ao fornecedor. Sem campanhas automáticas.
- Dados sensíveis desnecessários não são coletados. CPF/CNPJ não é solicitado
  no MVP.

## Ameaças cobertas por teste

| Ameaça | Controle | Evidência |
| --- | --- | --- |
| A lê dados de B | RLS + testes A/B | `npm run test:db` |
| Forjar org no insert | `WITH CHECK` + FK composta | `npm run test:db` |
| Preço adulterado no pedido | total no banco | `npm run test:db` |
| Produto de outro tenant | validação no RPC | `npm run test:db` |
| Token de recompra vazado | hash no banco + TTL/revogação | unit + DB |
| Replay de webhook | `provider_event_id UNIQUE` | unit + DB |
| Webhook sem token | comparação constante | unit |
| `successUrl` ativa acesso | state machine ignora callback | unit |
| Evento fora de ordem | `last_provider_event_at` | unit |
| Valor/tenant divergente | validação server-side | unit |
| Abuso de pedidos | rate limit atômico | DB |
| XSS | React + CSP | build/revisão |

## Delta V2 — Parte 1/5 (PROPOSED)

### Superadmin e console

- Privilégio deriva exclusivamente de `platform_admins.user_id`; e-mail,
  `user_metadata`, claim editável e URL nunca concedem acesso.
- Cada endpoint admin revalida JWT, UUID e `aal=aal2` (TOTP) no servidor; 401
  para anônimo/expirado, 403 para AAL1/fornecedor. `service_role` só na Edge.
- Bootstrap exige `ADMIN_EMAIL` + token dedicado + AAL2; ausente o e-mail,
  `ADMIN_BOOTSTRAP_BLOCKED` e console fechado. Não há segundo admin.
- Ações admin exigem motivo, geram `platform_audit_events` (ator, ação, alvo,
  status, timestamp) e nunca alteram pagamento/cartão/crédito sem prova do
  Asaas.

### Planos, entitlements e quotas

- `plan_catalog` é a única fonte de preço/moeda/versão; webhook compara o valor
  confirmado com o plano da assinatura, nunca com o navegador.
- `assert_entitlement` e `consume_quota` rodam no banco/Edge e falham fechados;
  flags de UI não autorizam. Quotas são atômicas por tenant e auditáveis.
- Downgrade/expiração revoga novas escritas premium sem apagar histórico;
  admin de plataforma não se mistura com plano de fornecedor.
- Checkout Profissional fica desativado por flag até a Parte 2/4; nenhuma
  transição automática cria segunda recorrência no Asaas.

### Trial e minimização

- `trial_grants` imutável por usuário/organização; recriar organização não
  reinicia trial.
- Sinais de contato/rede são HMAC-SHA-256 com segredo server-side e retenção
  mínima; repetição gera revisão manual, não veto permanente automático.
- IP/dispositivo são sinais fracos; nenhum fingerprint invasivo, CPF ou SMS
  pago é coletado.

### Tema

- Preferência local sem PII; sem flash; contraste verificado em light/dark por
  axe/smoke. Tokens não carregam segredo nem dados de sessão.

## Fora de escopo de segurança

WAF dedicado, pentest externo, SOC2, gestão de dispositivos, antivírus de
upload (não há upload) e proteção contra DDoS além da infraestrutura dos
provedores.
