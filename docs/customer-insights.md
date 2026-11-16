# Relatório de clientes — metodologia e operação (#54)

## Objetivo

Mostrar inatividade, recorrência e valor **em pedidos** para o fornecedor agir
manualmente, sem transformar pedido em receita recebida e sem disparar
mensagens automáticas.

## Fonte dos dados

- Apenas pedidos com status `confirmed` ou `completed` entram nas métricas.
- `canceled` e rascunhos ficam fora de contagem, valor, última compra e cadência.
- O histórico do cliente mostra todos os pedidos, inclusive cancelados, com o
  status explícito; o cancelado não soma nas métricas.
- Datas são armazenadas em UTC e exibidas em `America/Sao_Paulo`.
- Nenhum dado bancário, de cartão ou de recebimento é lido ou inferido.

## Segmentos

| Segmento | Regra |
| --- | --- |
| `no_purchases` | Nenhum pedido confirmado/concluído. Não é rotulado como perdido. |
| `inactive` | Último pedido válido antes da janela configurada (30/60/90 dias). |
| `insufficient` | Um único pedido válido dentro da janela; sem cadência confiável. |
| `reactivated` | Tinha pedido anterior fora da janela e voltou a comprar dentro dela. |
| `overdue` | Fora do intervalo mediano do próprio cliente + tolerância da organização, mas ainda dentro da janela. |
| `regular` | Tem pedidos válidos dentro da janela e não está atrasado. |

A janela é aplicada por data em São Paulo. A primeira indicação vence por
critério determinístico: `inactive` antes de `insufficient`; `reactivated` antes
de `overdue`.

## Métricas

- `valid_order_count`: pedidos confirmados/concluídos.
- `orders_value_cents`: soma desses pedidos; **não é receita recebida**.
- `confirmed_value_cents` e `completed_value_cents`: separação explícita.
- `median_interval_days`: mediana dos intervalos entre pedidos válidos; exige
  ao menos 2 pedidos.
- `frequency_trend`: compara a mediana dos 3 intervalos mais recentes com a dos
  anteriores. `up` = acelerando, `down` = desacelerando, `stable` = estável,
  `insufficient` = histórico curto.
- Resumo: total, ativos, inativos, reativados, sem compras, histórico curto e
  valores agregados. `total = ativos + inativos + sem compras`.

## Interface

- Rota `/app/relatorios` (Profissional), acessível também por “Relatório” em
  Clientes.
- Filtros de janela, segmento e busca; paginação de 25.
- Ações: histórico do cliente (até 20 pedidos, com link para o pedido) e
  WhatsApp manual. O link abre o aplicativo; nada é enviado pelo servidor.
- Exportação CSV de até 2.000 clientes, com BOM e proteção contra fórmula
  (`=`, `+`, `-`, `@`, tab, CR recebem prefixo `'`). Telefone só sai quando o
  papel tem permissão de escrita em clientes.
- “Como calculamos” fica visível na própria tela.

## Segurança e limites

- RPCs `security definer` com `search_path` fixo, checagem de
  `reports.read`, entitlement `inactive_customers` e isolamento por
  `organization_id`.
- Viewer lê o relatório, mas recebe telefone nulo e não busca por telefone.
- Nenhum cache compartilhado entre organizações; o estado é recarregado ao
  trocar de organização.
- Consultas usam índice parcial em pedidos válidos por cliente.
- O relatório não substitui contabilidade, conciliação Asaas ou receita
  reconhecida.

## Endpoints

- `api_customer_insights(org, dias, segmento, busca, limite, offset)`
- `api_customer_insights_summary(org, dias)`
- `api_customer_order_history(org, cliente, limite, offset)`

## Testes

- DB: segmentos, cancelados, janelas 30/90/200, resumo, histórico, RLS A/B,
  viewer sem telefone, Essencial bloqueado.
- Unit: CSV com fórmula/aspas, BOM, nome de arquivo, tela e upsell.
- Edge/DB suite: `npm run test:db` (79 PASS no incremento).
