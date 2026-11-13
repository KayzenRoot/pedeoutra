# Decisions Ledger

Status: `APPROVED` = decidido pela Work Order ou auditoria autorizada;
`PROPOSED` = implementado nesta WO, aguardando promoção; `SUPERSEDED` = substituído.

## ADR PDA-ADR-001 — Stack do MVP

**Status:** APPROVED (Work Order, seção 4)
**Data:** 2026-11-12
**Contexto:** MVP de baixo custo, time pequeno, multi-tenant, pagamento recorrente.
**Decisão:** React + Vite + TypeScript; CSS moderno; Supabase PostgreSQL/Auth;
Edge Functions para operações privilegiadas; Cloudflare Pages; Asaas Checkout
recorrente; GitHub Actions.
**Consequências:** menos serviços, RLS no banco, funções como fronteira de
confiança; dependência de Supabase/Asaas/Cloudflare e seus limites de plano.
**Alternativas rejeitadas:** Vercel Hobby para SaaS pago; backend próprio;
gateway de pagamento dos pedidos B2B (fora de escopo).

## ADR PDA-ADR-002 — Cobrança e liberação de acesso

**Status:** APPROVED (requisitos de segurança da Work Order, seções 7 e 8)
**Data:** 2026-11-12
**Contexto:** acesso pago não pode depender de callback do navegador.
**Decisão:** checkout hospedado Asaas; assinatura só ativa com evento de
pagamento validado (token do webhook, valor, tenant, assinatura e estado);
`provider_event_id` único; estados `pending|active|past_due|canceled|expired|refunded`;
reembolso revoga; evento atrasado não reativa; reconciliação separada.
**Consequências:** exige credenciais e webhook público; sem elas, billing fica
`PROD BLOCKED`. Nenhum dado de cartão no PedeOutra.

## ADR PDA-ADR-003 — APIs públicas exclusivamente via Edge Functions

**Status:** PROPOSED
**Data:** 2026-11-12
**Contexto:** reduzir superfície de exposição de tabelas e evitar policies
públicas frágeis.
**Decisão:** `anon` não recebe grant em tabelas; catálogo, pedido e recompra
passam por funções que usam `service_role` no servidor e devolvem DTOs mínimos.
**Consequências:** mais uma camada de código; testes de handler e RPC
obrigatórios. PostgREST segue usado apenas pelo fornecedor autenticado.

## ADR PDA-ADR-004 — CSS moderno em vez de Tailwind

**Status:** PROPOSED
**Data:** 2026-11-12
**Contexto:** WO permite Tailwind ou CSS moderno; evitar design system pesado.
**Decisão:** CSS com custom properties e componentes pequenos.
**Consequências:** menos dependências e build simples; exige disciplina de
nomenclatura e revisão visual.

## ADR PDA-ADR-005 — Máquina de estados de pedido no banco

**Status:** PROPOSED
**Data:** 2026-11-12
**Contexto:** impedir transições inválidas mesmo se o frontend for contornado.
**Decisão:** trigger valida `new → confirmed|canceled`, `confirmed → completed|canceled`;
cada transição grava `order_status_events` com autor e horário.
**Consequências:** regra única no banco; UI apenas reflete as opções válidas.

## ADR PDA-ADR-006 — Recompra por token opaco com hash

**Status:** PROPOSED
**Data:** 2026-11-12
**Contexto:** link de recompra não pode virar credencial permanente nem expor PII.
**Decisão:** 32 bytes CSPRNG, SHA-256 no banco, TTL 60 dias, revogação, rate
limit, template com IDs/quantidades; preço atual recalculado no servidor.
**Consequências:** token só aparece uma vez; perda exige novo link; sem dados
do cliente na página.

## ADR PDA-ADR-007 — Região e plano do Supabase no staging

**Status:** APPROVED (decisão de staging, 2026-11-13)
**Contexto:** o projeto `waygtbclkxklexnabwvj` está em East US/Ohio; a produção
monetizada está bloqueada, não há usuários reais e a migração para São Paulo
exigiria recriar o projeto, chaves, Auth, secrets, Edge Functions e webhook.
**Decisão:** manter East US/Ohio no staging/MVP, com Supabase Free e keepalive
diário via GitHub Actions. Antes do go-live, migrar para `sa-east-1` e contratar
o plano Pro.
**Consequências:** latência maior para usuários brasileiros no staging; a
migração e o upgrade são pré-requisitos de produção, não tarefas silenciosas. O
keepalive reduz o risco de pausa, mas não garante disponibilidade.
**Alternativas rejeitadas:** migrar agora, sem usuários e com produção bloqueada;
manter Free em produção com pagantes.

## ADR PDA-ADR-008 — Asaas produção configurado

**Status:** APPROVED (13/11/2026)
**Contexto:** a conta de produção foi aprovada; o staging já validou checkout,
webhook, idempotência e estados de billing no Sandbox.
**Decisão:** usar API key/base URLs de produção, webhook exclusivo com 13 eventos
e o mesmo código de Edge Functions. Validar com checkout de produção sem
pagamento; a primeira cobrança real exige autorização explícita.
**Consequências:** produção pronta para teste controlado, sem dinheiro real
movimentado; Sandbox removido. Domínio, Supabase Pro/migração e auditoria
continuam pré-requisitos do go-live comercial.
