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
- Recuperação de senha (solicitação genérica anti-enumeração, senhas
  divergentes, link inválido/sem sessão) e `safeInternalPath` contra open
  redirect no parâmetro `next`.
- Billing: 26 testes unitários cobrindo valor/tenant, duplicata, fora de ordem,
  reembolso, cancelamento, checkout e reconciliação.
- Total atual: 78 testes unitários/componente em 10 arquivos.

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

Status: PASS no GitHub Actions (run 43357841432) e localmente após o reparo do
Docker, 7 grupos e 0 FAIL — inclui Auth real, pedido, recompra, checkout,
webhook, duplicata, valor adulterado, cancelamento, reembolso e reconciliação.

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

## 7. Staging/sandbox

- URL: `https://pedeoutra.pages.dev`, projeto Cloudflare Pages Git conectado a
  `KayzenRoot/pedeoutra`, produção em `main`; push em `main` dispara build/deploy.
- `node scripts/prod-smoke.mjs` cria dados sintéticos e valida signup,
  organização, produto, catálogo, pedido, vínculo e recompra contra a URL real.
- Asaas produção: conta aprovada, API key/checkout/webhook configurados;
  checkout de produção criado (`201`, R$ 29,90/mês, host `www.asaas.com`) e
  evento `CHECKOUT_CREATED` recebido pelo webhook, **sem pagamento**. Usuário,
  organização, assinatura e eventos do teste foram removidos.
- Asaas Sandbox: checkout + cartão de teste + webhook autenticado + assinatura
  ativa; evidência em `evidence/logs/asaas-webhook-real.txt`. Sandbox e dados
  sintéticos foram removidos em 13/11/2026
  (`evidence/logs/staging-cleanup-2026-11-13.txt`).
- Recuperação de senha: `/recuperar-senha` e `/redefinir-senha` cobertos por 3
  testes de componente; o envio real de e-mail depende do SMTP próprio.
- Keepalive diário do Supabase (`supabase-keepalive`) valida `/auth/v1/health`;
  falha por dois dias exige verificação manual do projeto.
- Reconciliação diária (`billing-reconcile`) chama a Edge Function com
  `x-reconcile-token`; validação manual: 401 com token errado e 200 com
  `events_checked=0`/`checked=0` no staging limpo.
- Release health local: Pages 200, Auth health 200, webhook com token inválido
  401 e reconcile 200; workflow `release-health` preparado para rodar a cada 6h
  após o merge.
- Primeira cobrança real, SMTP, backup/continuidade (ADR-009 PROPOSED),
  suporte/legal e auditoria permanecem fora do escopo até autorização explícita;
  `pedeoutra.pages.dev` é a URL aprovada.

## Riscos não cobertos

- Primeira cobrança real no cartão (checkout de produção não foi pago).
- Domínio próprio e go-live comercial com Supabase Pro/`sa-east-1`.
- WhatsApp oficial (fora de escopo).
- Carga/estresse além de rate limit funcional.
