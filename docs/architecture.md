# Architecture

## Visão

```text
Navegador (React/Vite)
  ├─ Supabase Auth (JWT)
  ├─ PostgREST + RLS        → tabelas de negócio do próprio tenant
  └─ Edge Functions         → APIs públicas e operações privilegiadas
        ├─ public-catalog   → catálogo ativo, sem dados privados
        ├─ public-order     → pedido transacional com total no servidor
        ├─ reorder-get      → resolve token opaco, sem PII
        ├─ reorder-submit   → recria pedido com preço atual
        ├─ reorder-create   → emite token (auth do fornecedor)
        ├─ reorder-revoke   → revoga token
        ├─ link-order-customer → vincula pedido público a cliente
        ├─ create-checkout  → Asaas Checkout recorrente (auth)
        ├─ cancel-subscription → cancela renovação (auth)
        ├─ asaas-webhook    → evento autenticado e idempotente
        └─ billing-reconcile→ reprocessa eventos pendentes/falhos
              ↓ service role apenas no servidor
        PostgreSQL: tabelas + RLS + funções security definer
```

## Fronteiras de confiança

1. **Navegador**: nunca recebe `service_role`, chave Asaas ou token de webhook.
2. **PostgREST/RLS**: o fornecedor autenticado só lê/escreve o próprio tenant.
3. **Edge Functions**: validam entrada, aplicam rate limit, resolvem tokens,
   calculam preço/total e chamam o Asaas server-to-server.
4. **Banco**: funções `security definer` mínimas, com `search_path` fixo,
   executáveis apenas pelos papéis necessários. `app.submit_order` é exclusiva
   de `service_role`; o público nunca a chama diretamente.
5. **Asaas**: fonte de verdade do pagamento; webhook só é aceito com token
   dedicado, e o estado é confirmado por API antes de liberar acesso quando
   necessário.

## Decisões de implementação

- Uma organização por conta (`organizations.owner_user_id UNIQUE`).
- `slug` público gerado no servidor; nunca editável para evitar colisão.
- Produtos usam desativação, não exclusão física, preservando snapshots.
- Pedidos guardam `name_snapshot`, `unit_snapshot`, `unit_price_cents` e
  `subtotal_cents`; `orders.total_cents` é calculado no banco.
- Status de pedido é máquina de estados validada por trigger; cada transição
  gera `order_status_events` com autor e horário.
- Recompra usa token de 32 bytes (CSPRNG), SHA-256 no banco, TTL de 60 dias,
  revogação explícita e template JSON validado.
- Billing usa uma linha de `subscriptions` por organização e `billing_events`
  com `provider_event_id UNIQUE` para idempotência.
- Frontend sem design system: CSS com variáveis, componentes pequenos e
  acessíveis.

## Dados

Tabelas: `organizations`, `products`, `customers`, `orders`, `order_items`,
`order_status_events`, `reorder_links`, `subscriptions`, `billing_events`,
`audit_events`, `rate_limits`. Todas usam UUID; instantes em UTC. A view
`reorder_links_safe` omite `token_hash`.

## Delta V2 — Parte 1/5 (PROPOSED)

- **Planos:** `plan_catalog` versionado + `plan_feature_entitlements`; a
  assinatura referencia `plan_code`/`plan_version`. `app.assert_entitlement` e
  `app.consume_quota` são chamados por Edge/RPC; `plan_changes` registra
  intenções de troca sem efetivar cobrança.
- **Admin:** tabela privada singleton `platform_admins` (UUID de
  `auth.users`), Edge `admin-api` com `service_role` somente no servidor,
  revalidação de `aal=aal2` em cada request, auditoria em
  `platform_audit_events`. `admin-bootstrap` é one-time e fail-closed sem
  `ADMIN_EMAIL`.
- **Trial:** `trial_grants` imutável por usuário/organização; sinais
  normalizados em HMAC (`trial_signals`) geram revisão, não bloqueio automático
  por sinal fraco.
- **Tema:** tokens semânticos em `[data-theme=light|dark]`, resolução de
  `system` antes do primeiro paint e persistência em `localStorage`; nenhuma
  regra de negócio no cliente.
- **Fora do escopo:** API pública, Meta Ads, WhatsApp automatizado, equipe,
  preços privados e dashboard 360° permanecem nas Partes 2–4; aqui existem
  apenas feature keys e contratos.

## Limites conhecidos

- Staging usa Supabase Cloud, Cloudflare Pages Git e Asaas produção
  configurado (Sandbox para testes). Sem SMTP, backup/continuidade aceitos e
  revisão jurídica, o go-live comercial fica bloqueado; `pedeoutra.pages.dev` é
  a URL aprovada nesta fase.
- Sem WhatsApp API: apenas links `wa.me` acionados por humano.
- Sem upload de arquivos, estoque, nota fiscal ou pagamento dos pedidos.
