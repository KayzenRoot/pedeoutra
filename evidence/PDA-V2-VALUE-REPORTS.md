# PedeOutra V2 — relatório de clientes (#54) e indicações (#56)

Data: 2026-11-16
Branch: `feat/PDA-V2-P02-WO-001-catalog-team-whatsapp`
Estado: implementação interna concluída; PR #90 permanece Draft; sem deploy,
sem cobrança, sem crédito e sem envio automático.

## Escopo entregue

### #54 — clientes inativos, recorrência e valor

- Migração `supabase/migrations/20261115000100_customer_insights.sql`.
- Segmentos `no_purchases`, `inactive`, `insufficient`, `reactivated`,
  `overdue`, `regular`; janela 30/60/90 e resumo server-side.
- Valores separados em confirmado/concluído, sempre rotulados como pedidos, não
  receita recebida. Cancelados fora das métricas.
- Histórico do cliente com todos os pedidos e link para o pedido.
- CSV com BOM, limite de 2.000 linhas e proteção de fórmula.
- Viewer sem telefone; Profissional obrigatório; RLS/tenant por RPC.
- UI `/app/relatorios`, atalho em Clientes, nav desktop e documentação em
  `docs/customer-insights.md`.

### #56 — indicações em modo seguro

- Migração `supabase/migrations/20261115000200_referrals.sql`.
- Código opaco, rotação, revogação, expiração e limite de usos.
- Atribuição no onboarding, primeira indicação vence, autoindicação bloqueada e
  telefone idêntico sinalizado/rejeitado.
- Recompensa somente após primeiro pagamento confirmado; ledger sempre
  `pending`, valor nulo, sem Asaas.
- Reversão por refund e por admin com motivo + auditoria.
- Painel em Configurações, visão admin, doc `docs/referrals.md`.
- Hook no `billing-processor` não falha o processamento de billing se a
  qualificação/reversão falhar; o evento de pagamento continua sendo a fonte de
  verdade.

## Evidência de execução

| Verificação | Resultado |
| --- | --- |
| `npm run lint` | 0 erros |
| `npm run typecheck` | 0 erros |
| `npm run test:unit` | **161 PASS, 0 FAIL** (34 arquivos) |
| `npm run test:db` | **79 PASS, 0 FAIL** (14 grupos) |
| `npm run test:edge` | typecheck de 57 Edge Functions |
| `npm run test:edge-http` | **57 PASS, 0 FAIL** |
| `npm run build` + `test:seo` | PASS |
| `npm run smoke:preview` | PASS light/dark/system desktop/mobile; axe 0 violações |

## Testes críticos adicionados

- Cancelado não conta pedido, não altera última compra e não infla valor.
- Janela 30/90/200 muda o segmento de forma determinística.
- Resumo fecha `total = ativos + inativos + sem compras` e
  `valor total = confirmado + concluído`.
- Viewer lê relatório sem telefone e não busca por telefone.
- Essencial recebe `plan_required`; B não lê A.
- Histórico inclui cancelado com status, mas métricas continuam excluindo.
- Indicação: autoindicação, duplicidade, mesmo telefone, rotação, expiração,
  limite, qualificação única, ledger pendente, refund e reversão admin.
- `admin-api` reverte indicação e grava auditoria sem tocar no Asaas.

## Invariantes

- Nenhuma chave, token, service_role ou segredo no browser/repo/log.
- Nenhuma alteração em produção neste incremento.
- Nenhum crédito/desconto/cancelamento emitido.
- Nenhuma mensagem automática de WhatsApp/e-mail disparada.
- Nenhum dado real usado nos testes; apenas sintético em container isolado.

## Pendências externas

- Aprovação financeira e ADR antes de conceder qualquer recompensa.
- Deploy autorizado das migrations/functions; PR #90 segue Draft.
- SMTP, WABA/Meta, backup/PITR, legal/suporte e primeira cobrança real seguem
  bloqueados conforme `evidence/PDA-V2-FINAL-AUDIT.md`.
