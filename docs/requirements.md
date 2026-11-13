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
- Sem credenciais: integração compila/testa com mocks e fica `PROD BLOCKED`.

### RF-07 Landing e onboarding (PDA-009)

- Landing PT-BR mobile-first com proposta honesta, preço, FAQ, demo fictícia,
  privacidade e termos preliminares sinalizados para revisão humana.
- CTA de teste de 7 dias leva ao cadastro; analytics sem PII e desativado por padrão.

### RF-08 Deploy e evidências (PDA-010/011)

- CI executa lint, typecheck, testes e build.
- Deploy documentado para Cloudflare Pages, Supabase e Asaas.
- Evidence Bundle com SHA, comandos, exit codes, riscos e veredito.
- PR #12 mesclado após autorização explícita; merges futuros exigem auditoria.

## Não funcionais

- PT-BR, BRL, exibição em `America/Sao_Paulo`, persistência em UTC.
- Mobile-first, acessível por teclado, contraste e foco visível.
- Validação server-side de toda entrada; queries parametrizadas.
- Sem segredo no Git, no bundle ou em logs.
- Migrations reproduzíveis; backup/restore documentado e testado com dados sintéticos.
- Custo: nenhum serviço pago novo sem aprovação.
