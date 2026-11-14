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
| #55 | Comprovante de pedido em PDF A4, sem natureza fiscal | implementado neste branch |

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

## Evidência local (HEAD de trabalho)

| Verificação | Resultado |
| --- | --- |
| `npm run test:db` | **60 PASS, 0 FAIL** |
| `npm run test:edge` | typecheck de **35 Edge Functions** |
| `npm run test:edge-http` | **43 PASS, 0 FAIL** |
| `npm run test:unit` | **144 PASS, 0 FAIL** (27 arquivos) |
| `npm run test:full-local` | **7 PASS, 0 FAIL** |
| `npm run test:restore` | PASS; inclui tabelas de preço, quotes, itens, eventos e links |
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
- Itens seguintes da Parte 2: #58 equipe/RBAC, #29–#31 contrato WhatsApp e
  #63 páginas comerciais.
