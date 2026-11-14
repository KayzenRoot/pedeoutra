import { HttpError } from './http.ts'

/**
 * Converte erros do RPC transacional em respostas HTTP estáveis, sem expor
 * detalhes internos do banco.
 */
export function throwOrderError(error: { message?: string } | null): never {
  const message = error?.message ?? ''

  if (message.includes('rate_limited')) {
    throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos.')
  }
  if (message.includes('organization_unavailable')) {
    throw new HttpError(
      409,
      'catalog_unavailable',
      'Este catálogo não está aceitando pedidos no momento.',
    )
  }
  if (message.includes('organization_not_found')) {
    throw new HttpError(404, 'catalog_not_found', 'Catálogo não encontrado.')
  }
  if (message.includes('invalid_reorder_link')) {
    throw new HttpError(404, 'link_unavailable', 'Este link não está mais disponível.')
  }
  if (message.includes('invalid_price_token')) {
    throw new HttpError(
      404,
      'price_link_unavailable',
      'Este link de preços não está mais disponível.',
    )
  }
  if (message.includes('plan_required')) {
    throw new HttpError(403, 'plan_required', 'Esta funcionalidade exige o plano Profissional ativo.')
  }
  if (message.includes('quantity_below_minimum')) {
    throw new HttpError(400, 'quantity_below_minimum', 'Quantidade abaixo do mínimo deste item.')
  }
  if (message.includes('quantity_not_multiple')) {
    throw new HttpError(400, 'quantity_not_multiple', 'Quantidade fora do múltiplo de embalagem.')
  }
  if (message.includes('order_below_minimum_items')) {
    throw new HttpError(400, 'order_below_minimum_items', 'Pedido abaixo da quantidade mínima de itens.')
  }
  if (message.includes('order_below_minimum')) {
    throw new HttpError(400, 'order_below_minimum', 'Pedido abaixo do valor mínimo.')
  }
  if (message.includes('minimum_unverifiable')) {
    throw new HttpError(
      409,
      'minimum_unverifiable',
      'Este pedido tem itens sem preço; solicite um orçamento ao fornecedor.',
    )
  }
  if (message.includes('request_conflict')) {
    throw new HttpError(409, 'request_conflict', 'Requisição conflitante. Recarregue a página.')
  }
  if (
    message.includes('invalid_product') ||
    message.includes('invalid_items') ||
    message.includes('duplicate_items') ||
    message.includes('invalid_buyer') ||
    message.includes('buyer_required') ||
    message.includes('invalid_note') ||
    message.includes('order_too_large')
  ) {
    throw new HttpError(400, 'invalid_order', 'Revise os itens e os dados informados.')
  }

  throw new HttpError(500, 'order_failed', 'Não foi possível registrar o pedido.')
}
