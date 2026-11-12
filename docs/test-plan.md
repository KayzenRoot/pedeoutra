# Test Plan

## Estratégia

Testar o que pode causar dano real: isolamento tenant, integridade de pedido,
token de recompra, autorização e billing. Evitar testes triviais para inflar
cobertura.

## Camadas

### 1. Unitários (Vitest)

- Validação de payload de pedido (limites, quantidades, UUID, duplicidade,
  honeypot, telefone, textos).
- Tokens de recompra: entropia/formato, hash, rejeição de formato inválido.
- Máquina de estados de billing: pagamento válido, valor adulterado, tenant
  divergente, duplicado, fora de ordem, reembolso, cancelamento, atraso,
  `successUrl` inerte.
- Cliente Asaas: endpoint, header `access_token`, preço fixo, parsing de erro.
- Formatação BRL/data em `America/Sao_Paulo`.
- Reducer do carrinho e regras de acesso exibidas no frontend.

### 2. Banco real (Postgres em Docker)

Script `scripts/db-test.mjs`:

1. Sobe Postgres 17 isolado.
2. Cria o stub de `auth.users`/`auth.uid()` e papéis do Supabase.
3. Aplica todas as migrations.
4. Cria usuários A/B, organizações, produtos, clientes e pedidos.
5. Executa como `authenticated` com JWT claim de A/B:
   - A vê somente o próprio tenant.
   - A não lê/escreve B, mesmo forjando `organization_id`.
   - Colunas sensíveis (`token_hash`) não são acessíveis.
   - RLS bloqueia `anon`.
   - Trial expirado bloqueia escrita; assinatura ativa libera.
6. Executa como `service_role`:
   - `app.submit_order` calcula total e ignora preço do cliente.
   - Produto inativo/de outro tenant é rejeitado.
   - Rate limit atômico funciona.
   - Recompra expirada/revogada falha; válida cria pedido com `customer_id`.
   - `billing_events` duplicado é inofensivo.
   - Transições de status válidas/inválidas e auditoria.

### 3. HTTP real (PostgREST e handlers)

- `npm run test:postgrest`: sobe PostgREST sobre Postgres real e valida
  `create_organization`, CRUD com RLS, `api_submit_order`, leitura de pedidos,
  view segura e transição de status via HTTP.
- `npm run test:edge-http`: executa os handlers Deno reais (públicos e
  autenticados) em um router local, contra PostgREST. Usa um stub de GoTrue apenas
  para validar o caminho de sessão; não substitui o teste com Supabase Auth real.
- Billing sem credenciais retorna `503 billing_not_configured` (esperado).

### 4. E2E completo local (GoTrue real + Asaas mock)

`npm run test:full-local` sobe Postgres, GoTrue real, PostgREST, proxy
`/auth/v1` + `/rest/v1` + `/functions/v1`, handlers Deno e mock HTTP do Asaas.
Cobre signup/login, organização, produto, catálogo, pedido, vínculo de cliente,
recompra, checkout, webhook idempotente, valor adulterado, cancelamento,
reembolso e reconciliação.

Status nesta máquina: execução parcial (Auth real, organização, produto,
catálogo, pedido e vínculo passaram); bloqueada pelo daemon Docker antes de
concluir recompra/billing. O script fica versionado para ambiente Docker
saudável e não é contado como PASS completo.

### 5. Restore

`scripts/verify-restore.mjs` cria dados sintéticos, faz `pg_dump`, restaura em
outro banco e compara contagens/checksums. Nenhum dado real é usado.

### 6. Build e CI

- ESLint.
- `tsc --noEmit` (app e configuração).
- `vite build`.
- `deno check` das Edge Functions.
- Smoke do build: browser headless (Chrome/Chromium) percorre landing, demo,
  privacidade, termos e 404, roda axe WCAG 2 A/AA em landing/demo (desktop e
  mobile) e salva screenshots; sem browser, verifica shell SPA e assets.

## Matriz de risco

| Área | Risco | Teste mínimo |
| --- | --- | --- |
| Auth/tenant | ELEVATED | RLS A/B, RPC de organização |
| Pedido público | ELEVATED | total server-side, anti-spam, produto inválido |
| Recompra | ELEVATED | token, TTL, revogação, PII, replay |
| Billing | HIGH_ASSURANCE | sandbox/mocks, idempotência, valor, tenant, ordem |
| Deploy | ELEVATED | build + smoke; produção BLOCKED sem credenciais |

## Definition of Done de teste

- `npm run verify` verde.
- `npm run test:db` verde com exit code 0.
- `npm run test:restore` verde.
- Nenhum teste faz chamada real ao Asaas ou usa dado pessoal real.
- Evidências com comando, saída e exit code no Evidence Bundle.

## Riscos não cobertos

- Fluxo real de cartão no Asaas (sem credenciais).
- Deploy e smoke em produção (sem credenciais).
- WhatsApp oficial (fora de escopo).
- Carga/estresse além de rate limit funcional.
