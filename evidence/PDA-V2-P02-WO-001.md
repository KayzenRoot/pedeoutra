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
| #48 | Preços por comprador, tabela privada e link opaco | implementado neste branch |

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

## Evidência local (HEAD de trabalho)

| Verificação | Resultado |
| --- | --- |
| `npm run test:db` | **54 PASS, 0 FAIL** |
| `npm run test:edge` | typecheck de **28 Edge Functions** |
| `npm run test:edge-http` | **39 PASS, 0 FAIL** |
| `npm run test:unit` | **133 PASS, 0 FAIL** (24 arquivos) |
| `npm run test:full-local` | **7 PASS, 0 FAIL** |
| `npm run test:restore` | PASS; inclui `price_lists`, `price_list_items`, atribuições e tokens |
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
- `app.submit_order`, `app.customer_price` e `api_submit_order` não são
  executáveis por `authenticated`; somente `service_role`.
- Nenhuma chave de serviço, Asaas, Meta ou SMTP é usada no browser.

## Limites e pendências

- Migrations e Edge Functions da Parte 2 **não foram aplicadas/publicadas em
  produção**; a ativação exige autorização e backup.
- SMTP próprio pendente (convites de equipe bloqueados).
- WhatsApp oficial depende de WABA, templates e consentimento aprovados.
- Admin bootstrap de produção segue pendente de TOTP/AAL2 do proprietário.
- Itens seguintes da Parte 2: #51 orçamentos, #55 PDF não fiscal, #58 equipe/RBAC,
  #29–#31 contrato WhatsApp e #63 páginas comerciais.
