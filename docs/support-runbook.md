# Runbook de suporte, privacidade e incidentes

## Status do canal

**BLOCKED:** ainda não há e-mail/URL de suporte e privacidade aprovado pelo
proprietário. Não publicar contato fictício nem usar dados pessoais do
proprietário como canal público. O repositório pode ser usado para
desenvolvimento, mas não deve ser anunciado como suporte comercial.

Até o canal oficial ser aprovado, o produto não deve ser vendido ao público.

## Responsáveis

- Incidentes, privacidade e decisão de go-live: proprietário do repositório
  (`KayzenRoot`), contato interno registrado fora do Git.
- Operação técnica: executor/agente autorizado, com acesso aos provedores.
- Jurídico: revisão humana externa obrigatória; ainda não contratada.

## Atendimento e cancelamento

1. Confirmar identidade do solicitante e a organização envolvida.
2. Para suporte funcional: reproduzir em staging com dados sintéticos; nunca
   pedir senha, token de recompra ou dados de cartão.
3. Cancelamento de assinatura: usar o fluxo do Asaas/painel; a renovação é
   interrompida e o acesso pago permanece até o fim do período já pago.
4. Reembolso: quando cabível, o estorno revoga o acesso pago; trial vigente não
   é estendido. Registrar o caso e a decisão.
5. Prazo de primeira resposta: definir com o proprietário antes do lançamento.

## Solicitações LGPD

O fornecedor é controlador dos dados dos compradores; o PedeOutra é operador.
Para dados de conta/assinatura do fornecedor, o PedeOutra é controlador.

Procedimento manual:
1. Registrar data, solicitante, organização e tipo de pedido.
2. Validar identidade por canal oficial.
3. Localizar dados em `organizations`, `customers`, `orders`, `order_items`,
   `reorder_links`, `subscriptions`, `audit_events` e `rate_limits`.
4. Para acesso/correção: exportar ou corrigir apenas o escopo autorizado.
5. Para eliminação: remover dados operacionais; avaliar retenção legal e
   backups. Não prometer eliminação imediata de backups.
6. Responder dentro do prazo legal aplicável e registrar a conclusão.
7. Nunca executar `delete` em produção sem inventário, backup/reversão e
   autorização do proprietário.

## Incidentes

1. Classificar (auth, exposição de dados, billing, indisponibilidade, abuso).
2. Conter: revogar tokens/chaves afetadas, pausar webhook ou acesso se
   necessário; preservar logs redigidos.
3. Avaliar impacto em titulares e obrigações de comunicação (ANPD/titulares).
4. Corrigir, testar e registrar post-mortem sem PII/segredos.
5. Comunicar o proprietário e, quando exigido, os titulares.

## Retenção operacional

- Conta/organização: enquanto ativa; exclusão mediante solicitação.
- Clientes/pedidos: enquanto necessários à operação e obrigações legais.
- `rate_limits`: curta duração.
- `billing_events`/`audit_events`: necessários para idempotência e auditoria;
  avaliar retenção mínima antes de expurgo.
- Backups: conforme plano aprovado em `docs/backup-restore.md`.

## Gate de lançamento

Não liberar venda pública enquanto todos forem verdadeiros:

- canal oficial de suporte e privacidade publicado;
- termos/privacidade revisados por humano;
- plano de backup/continuidade aceito;
- SMTP/confirmação/recuperação homologados;
- primeira cobrança real autorizada e conciliada.
