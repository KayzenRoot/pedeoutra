# PDA-V2-P02-WO-001 — Evidência da Parte 2 (em andamento)

## Escopo entregue no branch

Branch: `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp`
PR: [#90](https://github.com/KayzenRoot/pedeoutra/pull/90) (Draft)

| Issue | Incremento | Estado |
| --- | --- | --- |
| #52 | Categorias e mídia privada com validação por magic bytes | implementado |
| #47 | SKU normalizado, busca e pedido por lista de SKU | implementado |
| #49 | Mínimo de pedido, mínimo por item e múltiplo de embalagem | implementado |
| #46 | Importação CSV/XLSX com dry-run, job idempotente e tudo-ou-nada | implementado |
| #57 | Templates de catálogo versionados e idempotentes | implementado |
| #53 | QR local do catálogo, sem serviço externo | implementado |
| #50 | Acompanhamento público por token opaco, TTL e revogação | implementado |
| #48 | Preços por comprador, tabela privada e link opaco | implementado |
| #51 | Orçamentos B2B com aceite opaco e conversão única em pedido | implementado |
| #55 | Comprovante de pedido em PDF A4, sem natureza fiscal | implementado |
| #63 | Comparação comercial dos dois planos na landing | implementado |
| #29–#31 | Contrato WhatsApp oficial, opt-in, outbox e webhook | implementado com envio desligado; verificação Meta pendente |
| #58 | Equipe, RBAC e convites manuais com AAL2 | implementado; envio de e-mail depende de SMTP |
| #44 | Radar de recompra por cadência real | implementado neste branch |
| #45 | Lembretes manuais com consentimento e histórico | implementado; envio automático desligado |
| #78 | Analytics first-party do funil, consentimento e fontes | implementado |
| #79 | Métricas financeiras administrativas (MRR, recebimentos, churn) | implementado |
| #80 | Dashboard executivo 360° | parcial: overview, organizações, auditoria, funil e financeiro |
| #74 | SEO técnico: robots, sitemap, metadados e Schema.org | implementado (prerender/status HTTP fica para #73) |
| #64/#65/#67 | API B2B v1: chaves, escopos, gateway, quota e OpenAPI | implementado (leitura) |
| #66 | Webhooks B2B de eventos | contrato pendente; não implementado |

## #48 — preços por comprador

- Tabelas `price_lists`, `price_list_items`, `customer_price_list_assignments` e
  `customer_price_tokens` com RLS por organização.
- `app.customer_price` resolve item privado válido com fallback para o preço
  público; `app.submit_order` exige token válido, entitlement `private_prices`,
  tabela ativa atribuída ao cliente e grava `price_list_id`/`price_source`.
- Token de 32 bytes aleatórios, persistido apenas como SHA-256; TTL de 30 dias,
  um token ativo por cliente e revogação explícita.
- `private-catalog-get` valida hash, expiração, revogação e entitlement; devolve
  catálogo com preços efetivos, sem telefone do comprador, com
  `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` e `Cache-Control: no-store`.
- `customer-price-link-create` e `customer-price-link-revoke` exigem sessão do
  fornecedor; criação exige entitlement e tabela ativa; revogação fica disponível
  mesmo com acesso pausado.
- `public-order` aceita `price_token` opcional, ignora nome/telefone quando o
  token identifica o cliente e mantém o cálculo do total no servidor.
- UI: `/app/precos` para tabelas, itens e atribuições; `/p/:token` reutiliza o
  catálogo com preços privados e sem pedir PII.
- `analytics.ts` mascara `/p/:token` e `/r/:token` para nunca enviar o token.

## #51 — orçamentos B2B

- Tabelas `quotes`, `quote_items`, `quote_events` e `quote_links`; status
  `draft|sent|accepted|declined|expired|canceled`, versão otimista, validade de
  até 90 dias e trilha de eventos.
- `app.build_quote_items` calcula o total no servidor com `app.quote_price`
  (tabela privada quando o cliente tem assignment e o plano permite; fallback
  público), congela snapshots e aplica mínimos/múltiplos.
- `app.send_quote` revalida o snapshot, cria/rotaciona link opaco com SHA-256 e
  TTL de até 30 dias, e registra o evento. Link anterior é revogado.
- `app.accept_quote` bloqueia a quote com `for update`, verifica status,
  validade, acesso do tenant, entitlement `quotes`, produtos ativos, preços e
  mínimos; cria no máximo um pedido, grava `orders.quote_id` e eventos com
  `request_id`/user agent. Replays retornam o mesmo pedido.
- Preço alterado, produto inativo ou política mínima violada marcam a quote como
  `expired` + `review_required`, sem pedido e sem alterar valores.
- `app.decline_quote` e `app.cancel_quote` revogam o link e não criam pedido;
  recusa é idempotente. RLS permite ao dono ler o histórico; escrita apenas por
  RPC/Edge com `service_role`.
- UI `/app/orcamentos` (Profissional) para montar, editar rascunho, enviar/rotacionar
  link, cancelar, revisar e ver eventos. Página pública `/o/:token` com aceite e
  recusa explícitos, sem login do comprador e sem PII de telefone.

## #55 — comprovante de pedido em PDF

- Gerador próprio em `src/lib/order-pdf.ts`, sem HTML, rede, fontes externas ou
  serviço de terceiros; PDF 1.4 A4 com Helvetica/WinAnsi, paginação, valores em
  BRL, acentos e nome de arquivo sanitizado.
- O fornecedor baixa o comprovante a partir dos snapshots do pedido no
  `OrderDetail`; há versão com comprador e versão sem PII, além de impressão.
- O comprador baixa uma versão reduzida na página de acompanhamento por token:
  sem telefone, observações, preços por item ou links; total e status vêm do DTO
  autorizado pelo token.
- Rodapé explícito em todas as páginas: “Comprovante de pedido, não é documento
  fiscal nem prova de pagamento.” Nenhum PDF contém token ou link opaco.
- Testes geram PDF real, verificam texto/acentos, versão sem PII, 50 itens com
  múltiplas páginas e sanitização de filename. O PDF também foi validado com
  `pdftotext` e renderizado com PyMuPDF durante a auditoria local.

## #63 — páginas comerciais

- A landing passou a comparar Essencial e Profissional lado a lado, com preços
  vindos de `plan-catalog` (fallback estático apenas se a API não estiver
  configurada), recursos por plano, trial e limites.
- O Profissional aparece como “Em preparação”, com checkout desabilitado e
  aviso de que WhatsApp automático depende de WABA/templates aprovados; nenhum
  recurso externo é apresentado como ativo.
- `Assinatura` já exibe plano atual, status, renovação, recursos e ações; o
  console admin já filtra organizações por estado/plano e audita ações. Não
  houve alteração no motor de cobrança, Asaas ou permissões.
- Smoke desktop/mobile light/dark/system e axe sem violações nas duas
  apresentações.

## #29–#31 — contrato WhatsApp oficial (envio desligado)

- `whatsapp_connections` guarda WABA/phone IDs e token cifrado com AES-GCM
  (chave em `WHATSAPP_ENCRYPTION_KEY`, fora do DB); a API nunca devolve o token.
- `whatsapp-connect` valida IDs/token, exige entitlement `whatsapp_automation` e
  deixa a conexão em `pending_verification`; `whatsapp-disconnect` limpa o token
  e bloqueia o envio. Não há chamada real à Meta para “verificar” sem permissões.
- Opt-in explícito no pedido público (`whatsapp_updates`) grava
  `orders.whatsapp_opt_in` e o trigger transacional cria no máximo um evento por
  `order_id:status` no outbox, com status `blocked` quando conexão/template não
  estão prontos e `pending` quando estão.
- `whatsapp-worker` exige token de worker, respeita `WHATSAPP_SEND_ENABLED`
  (desligado por padrão), tem retry limitado/backoff e só envia template
  aprovado; `whatsapp-webhook` valida HMAC SHA-256, atualiza entrega/leitura/
  falha e registra eventos sem PII desnecessária.
- UI de Configurações mostra status, criptografia/webhook, fila e formulário
  cifrado; textos deixam claro que a integração oficial e o envio automático
  dependem de WABA, templates e aprovação da Meta. WhatsApp manual continua
  inalterado.
- Testes cobrem cifra/decifra, opt-in, idempotência do outbox, worker desligado,
  HMAC inválido/válido, RLS A/B e ausência de token em claro.

## #58 — equipe, RBAC e convites manuais

- `organization_memberships` (owner/manager/operator/viewer) e
  `organization_invitations` com token CSPRNG hash, TTL, uso único, e-mail
  verificado e limite de 3 usuários no Profissional.
- Matriz de permissões aplicada em RLS e Edge: catálogo/preços/orçamentos por
  papel; billing, configurações, WhatsApp e equipe ficam com o owner. Nenhum
  membro vira owner por payload; o owner é protegido por trigger.
- `requireSupplier` resolve a organização pela membership ativa, não apenas por
  `owner_user_id`; as Edge Functions refazem `assertRole` e as operações
  sensíveis de equipe exigem AAL2/TOTP.
- Convite é criado como link manual (`email_sent:false`, `delivery:'manual'`)
  porque SMTP não está configurado. O aceite exige login, e-mail verificado e
  o mesmo e-mail do convite; replay, expiração, divergência e limite são
  bloqueados.
- Revogação muda o status da membership e bloqueia leitura/escrita nas próximas
  requisições; sessões existentes não mantêm escrita privilegiada. Trilha em
  `audit_events`.
- UI `/app/equipe` (owner), página `/convite/:token` e navegação por papel.

## #44/#45 — radar e lembretes manuais

- `api_reorder_radar` calcula mediana dos intervalos entre pedidos
  confirmados/concluídos, ignora cancelados/rascunhos, exige histórico mínimo
  configurável (2–10), aplica tolerância (0–30 dias) e retorna dias desde o
  último pedido, próxima estimativa e sinal `atrasado/em dia/sem dados`.
- O cálculo é determinístico e explicável; histórico curto retorna mediana e
  próxima estimativa nulas, sem inventar previsão. Fuso de apresentação
  America/Sao_Paulo, timestamps UTC.
- Cliente pode ser silenciado por 30 dias; pedidos novos, cancelados e histórico
  insuficiente são tratados explicitamente. RLS/Edge impedem acesso A/B.
- Lembretes são manuais: `reorder_reminders` registra sugestão/abertura, com
  idempotency key por ciclo/canal e opt-in do cliente. O fornecedor abre o
  `wa.me` com um clique; o sistema não alega envio/entrega. Envio automático
  continua desligado e depende de WABA/templates/Meta.
- UI `/app/radar` (Profissional) com busca, paginação, sinal, silenciar,
  histórico recente e ação manual; Configurações permitem ativar lembretes,
  frequência, histórico mínimo e tolerância; Clientes permite registrar opt-in.

## #78 — analytics first-party

- `analytics_events` e `analytics_consents` guardam apenas evento, sessão
  pseudônima, rota saneada, classe de referrer/UTM, versão de consentimento e
  metadata allowlisted; sem IP integral, e-mail, telefone, token ou query string.
- `analytics-ingest` valida allowlist, sessão, rota e consentimento; mascara
  `/p/`, `/r/`, `/o/`, `/convite/` e `/acompanhar/` para `:token`; rejeita
  eventos financeiros vindos do browser. `analytics-consent` registra
  analytics/marketing por sessão.
- Banner de consentimento global (analytics/marketing; necessários sempre
  ativos), respeita DNT/GPC e mantém analytics desligado por padrão. Eventos de
  landing, planos, CTA, FAQ, demo, catálogo, pedido, signup, trial e checkout
  são instrumentados; financeiros são derivados de `billing_events`/trial no
  servidor.
- `api_admin_analytics` e `api_admin_analytics_sources` só respondem a
  superadmin; o console `/admin` mostra funil de 30 dias e fontes, com ausência
  de dados distinta de zero.
- RLS nega acesso direto a `authenticated`; ingestão é pública, rate-limited e
  sem PII.

## #79/#80 — financeiro e dashboard administrativo

- `api_admin_financial` agrega no servidor MRR Essencial/Profissional/total,
  recebimentos confirmados/reconciliados, reembolsos, líquido após reembolsos,
  assinaturas ativas/past_due/canceladas/reembolsadas, trials, novos pagantes e
  churn do período, com definições explícitas e `last_sync`.
- MRR projetado, recebimento e lucro são apresentados separadamente; custos
  Meta/DeepSeek/Resend aparecem como `observed=false` (“indisponível”) enquanto
  as fontes não estiverem conectadas. Pedidos B2B não entram como receita SaaS.
- O console `/admin` (UUID+AAL2) ganhou cartões de funil/analytics e tabela
  financeira; visão geral, organizações, auditoria, filtros e ações seguem no
  mesmo console. Fornecedor/equipe/AAL1 continuam negados nas rotas globais.
- #80 permanece parcial: faltam seções de Meta/DeepSeek/Resend/API e saúde de
  integrações, que dependem de fontes externas/Parte 4; o painel atual não
  inventa valores ausentes.

## #74 — SEO técnico

- `robots.txt` bloqueia app, onboarding, admin, convite, acompanhamento e links
  opacos (`/r/`, `/p/`, `/o/`), mantendo landing, demo e documentos legais
  indexáveis; sitemap XML aponta para as URLs públicas.
- Metadados base no `index.html` incluem canonical, description, OG/Twitter e
  `og:url`; `useSeo` atualiza título/description/canonical/robots por rota em
  landing, demo, privacidade e termos.
- Landing publica JSON-LD `SoftwareApplication` com oferta Essencial; dados são
  estáticos e não incluem PII.
- O prerender/HTTP status real de SPA e a landing final continuam pendentes em
  #73/#82; esta entrega não declara HTML pré-renderizado.

## #64/#65/#67 — API B2B v1

- `api_keys` guarda SHA-256, prefixo, escopos (`catalog:read`, `orders:read`,
  `customers:read`), status, uso e revogação; o valor bruto `po_live_...` aparece
  uma única vez. Criação/listagem/revogação exigem owner + AAL2 + Profissional.
- `api-v1` autentica por bearer/x-api-key, exige entitlement `api_access`,
  aplica 60 req/min por chave e 10.000 req/mês por organização, e serve
  `/v1/me`, `/v1/products`, `/v1/customers` e `/v1/orders` com paginação e
  isolamento por organização. É somente leitura; não cria pedidos nem cobranças.
- `public/openapi.json` e `docs/api.md` documentam contrato, autenticação,
  escopos, limites e exemplos. #66 (webhooks B2B) permanece pendente e não é
  apresentado como disponível.

## Evidência local (HEAD de trabalho)

| Verificação | Resultado |
| --- | --- |
| `npm run test:db` | **70 PASS, 0 FAIL** |
| `npm run test:edge` | typecheck de **53 Edge Functions** |
| `npm run test:edge-http` | **55 PASS, 0 FAIL** |
| `npm run test:unit` | **150 PASS, 0 FAIL** (30 arquivos) |
| `npm run test:full-local` | **7 PASS, 0 FAIL** |
| `npm run test:restore` | PASS; inclui preços, quotes, WhatsApp, equipe, lembretes, analytics e API keys |
| `npm run lint` / `npm run typecheck` | 0 erros |
| `npm run build` | 0 erros |
| `npm run smoke:preview` | PASS light/dark/system desktop/mobile, 0 violações axe |

Logs locais usados durante a implementação:
`evidence/logs/test-db.log`, `evidence/logs/test-edge-http.log`,
`evidence/logs/test-unit.log`, `evidence/logs/test-restore.log`.

## Invariantes de segurança cobertos por teste

- RLS isola listas e atribuições entre organizações; cliente B não vê lista de A.
- Escrita de tabela exige plano Profissional ativo; Essencial recebe erro de RLS.
- Token inválido, expirado, revogado, de outro tenant ou sem tabela ativa não abre
  o catálogo privado.
- Pedido privado não persiste nome/telefone do comprador e usa o cliente do token.
- Preço privado e fallback público são gravados no snapshot do pedido.
- `app.submit_order`, `app.customer_price`, `api_submit_order`, `app.accept_quote`
  e `api_create_quote` não são executáveis por `authenticated`; somente
  `service_role`.
- Nenhuma chave de serviço, Asaas, Meta ou SMTP é usada no browser.

## Limites e pendências

- Migrations e Edge Functions da Parte 2 **não foram aplicadas/publicadas em
  produção**; a ativação exige autorização e backup.
- SMTP próprio pendente (convites de equipe bloqueados).
- WhatsApp oficial depende de WABA, templates e consentimento aprovados.
- Admin bootstrap de produção segue pendente de TOTP/AAL2 do proprietário.
- Pendente na Parte 2: envio automático de e-mail de convite (SMTP) e
  verificação real da WABA/templates pela Meta para ativar o WhatsApp.
