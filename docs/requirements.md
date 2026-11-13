# Requirements

## Funcionais

### RF-01 Conta e organização (PDA-002)

- Cadastro/login/logout por e-mail e senha via Supabase Auth.
- Uma organização por conta; criação server-side via RPC autenticada.
- Dados mínimos: nome fantasia, WhatsApp, cidade opcional.
- Trial de 7 dias calculado no servidor, sem cartão.
- RLS default-deny em todas as tabelas de negócio.

### RF-02 Produtos e clientes (PDA-003)

- CRUD de produto: nome, unidade, preço opcional em centavos, ativo/inativo.
- Desativação preserva histórico; sem estoque, CSV ou preço por cliente.
- Clientes com nome comercial e telefone, privados por tenant.
- Validação no servidor e estados vazios/erros úteis no painel.

### RF-03 Catálogo e pedido público (PDA-004)

- URL pública por fornecedor (`/c/:slug`), somente produtos ativos.
- Carrinho mobile com quantidades positivas e limite por item.
- Identificação mínima do comprador e consentimento de privacidade.
- Total e snapshots calculados no servidor; referência pública única.
- Anti-spam: honeypot, tempo mínimo, rate limit por IP/org, limites de payload.
- Nenhum acesso a cliente, histórico ou preço privado de terceiros.

### RF-04 Recompra (PDA-005)

- Fornecedor emite link opaco para cliente com pedido anterior.
- Token CSPRNG ≥ 128 bits; somente hash SHA-256 no banco; TTL e revogação.
- Link recria itens/quantidades sem exibir nome, telefone ou histórico.
- Preço atual é sempre validado no servidor; link inválido falha de forma neutra.
- Rate limit e uso único concorrente não podem duplicar pedido.

### RF-05 Painel de pedidos (PDA-006)

- Lista por organização, filtro por status, detalhe e cliente vinculado.
- Transições: `new → confirmed|canceled`, `confirmed → completed|canceled`.
- Histórico de status com horário e autor; trilha de auditoria mínima.
- Mensagem de WhatsApp pré-preenchida, disparada apenas por clique humano.

### RF-06 Assinatura (PDA-007)

- Plano único R$ 29,90/mês definido no servidor.
- Checkout hospedado do Asaas em sandbox; nenhum dado de cartão no app.
- Webhook autenticado por `asaas-access-token`, evento único persistido.
- `successUrl` é apenas informativa e nunca ativa acesso.
- Acesso liberado só após evidência de pagamento validada (valor, moeda, tenant,
  assinatura e estado no provedor).
- Cancelamento, atraso, reembolso e eventos fora de ordem tratados.
- Asaas produção configurado; testes usam mocks/Sandbox e a primeira cobrança
  real exige autorização explícita.

### RF-07 Landing e onboarding (PDA-009)

- Landing PT-BR mobile-first com proposta honesta, preço, FAQ, demo fictícia,
  privacidade e termos preliminares sinalizados para revisão humana.
- CTA de teste de 7 dias leva ao cadastro; analytics sem PII e desativado por padrão.

### RF-08 Deploy e evidências (PDA-010/011)

- CI executa lint, typecheck, testes e build.
- Deploy documentado para Cloudflare Pages, Supabase e Asaas.
- Evidence Bundle com SHA, comandos, exit codes, riscos e veredito.
- PR #12 mesclado após autorização explícita; merges futuros exigem auditoria.

## Delta V2 — Parte 1/5 (PROPOSED)

### RF-09 Administração da plataforma (PDA-V10-004)

- `/admin` acessível somente pelo UUID em `platform_admins` e sessão AAL2
  verificada no servidor em cada endpoint.
- Bootstrap one-time exige `ADMIN_EMAIL`, token dedicado e AAL2; sem
  `ADMIN_EMAIL`, responde `ADMIN_BOOTSTRAP_BLOCKED` e mantém o console fechado.
- Visão consolidada de organizações, trial/assinatura, plano, uso e risco, com
  paginação/filtros; ações de suspender, reativar e revisar trial exigem motivo
  e geram auditoria de plataforma.
- Nenhuma ação admin altera pagamento, cartão ou crédito sem prova do Asaas.

### RF-10 Dois planos e entitlements (PDA-PLN-001/002)

- Exatamente dois planos: `essential` (2990 centavos BRL/mês, trial 7 dias) e
  `professional` (6990 centavos BRL/mês, sem trial).
- Preço, moeda, versão e limites vêm do servidor; pagamento de 2990 nunca
  libera Profissional.
- `app.assert_entitlement`/quotas no banco e nas Edge Functions; UI não é
  autorização.
- Contas legadas viram Essencial preservando dados, período e assinatura;
  downgrade/expiração bloqueia novas ações premium sem apagar histórico.
- Profissional não é vendido nesta fase: checkout desativado por flag até a
  funcionalidade real da Parte 2/4.

### RF-11 Trial idempotente e revisão (PDA-V10-005)

- Trial concedido uma vez por usuário/organização no servidor, imutável e
  resistente a recriação de conta.
- Sinais repetidos de e-mail/telefone/CNPJ elevam risco e podem suspender o
  trial para revisão manual; IP/dispositivo são sinais fracos, nunca veto.
- Identificadores são guardados como HMAC com retenção mínima; suspensão,
  reativação e contestação são auditadas.

### RF-12 Configurações e tema (PDA-V10-002/009)

- Preferência de tema `light|dark|system` persistida no navegador, sem flash,
  com `color-scheme` e contraste verificável em todas as telas existentes.
- Configurações reais de conta/empresa, status de plano/trial/limites, canais
  desabilitados com mensagem honesta e ajuda/FAQ, sem fingir integração ativa.
- Textos de versão/estado refletem o release real; "MVP" não é renomeado por
  marketing antes dos gates.

## Não funcionais

- PT-BR, BRL, exibição em `America/Sao_Paulo`, persistência em UTC.
- Mobile-first, acessível por teclado, contraste e foco visível.
- Tema claro/escuro/system com contraste funcional e respeito a `prefers-color-scheme`.
- Validação server-side de toda entrada; queries parametrizadas.
- Sem segredo no Git, no bundle ou em logs.
- Migrations reproduzíveis; backup/restore documentado e testado com dados sintéticos.
- Custo: nenhum serviço pago novo sem aprovação.
