import { HttpError } from './http.ts'

/**
 * Converte erros dos RPCs de orçamento em respostas HTTP estáveis.
 * Nenhum detalhe interno do banco é exposto ao comprador ou ao fornecedor.
 */
export function throwQuoteError(error: { message?: string } | null): never {
  const message = error?.message ?? ''

  if (message.includes('rate_limited')) {
    throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos.')
  }
  if (message.includes('plan_required')) {
    throw new HttpError(403, 'plan_required', 'Esta funcionalidade exige o plano Profissional ativo.')
  }
  if (message.includes('organization_unavailable')) {
    throw new HttpError(409, 'catalog_unavailable', 'O acesso do fornecedor está pausado.')
  }
  if (message.includes('quote_link_unavailable')) {
    throw new HttpError(404, 'quote_link_unavailable', 'Este link de orçamento não está disponível.')
  }
  if (message.includes('quote_expired')) {
    throw new HttpError(410, 'quote_expired', 'Este orçamento expirou. Peça uma nova proposta.')
  }
  if (message.includes('quote_stale')) {
    throw new HttpError(
      409,
      'quote_stale',
      'Os preços ou condições mudaram. O fornecedor precisa revisar o orçamento.',
    )
  }
  if (message.includes('quote_product_inactive')) {
    throw new HttpError(
      409,
      'quote_product_inactive',
      'Um produto deste orçamento não está mais disponível. Peça uma revisão.',
    )
  }
  if (message.includes('quote_not_open')) {
    throw new HttpError(409, 'quote_not_open', 'Este orçamento não está mais aberto para aceite.')
  }
  if (message.includes('quote_not_editable')) {
    throw new HttpError(409, 'quote_not_editable', 'Este orçamento já foi enviado e não pode ser editado.')
  }
  if (message.includes('quote_not_cancelable')) {
    throw new HttpError(409, 'quote_not_cancelable', 'Este orçamento não pode mais ser cancelado.')
  }
  if (message.includes('quote_version_conflict')) {
    throw new HttpError(409, 'quote_version_conflict', 'O orçamento mudou. Recarregue a página.')
  }
  if (message.includes('quote_not_found')) {
    throw new HttpError(404, 'quote_not_found', 'Orçamento não encontrado.')
  }
  if (message.includes('quote_price_missing')) {
    throw new HttpError(
      409,
      'quote_price_missing',
      'Defina um preço para todos os itens antes de criar o orçamento.',
    )
  }
  if (message.includes('request_conflict')) {
    throw new HttpError(409, 'request_conflict', 'Requisição conflitante. Recarregue a página.')
  }
  if (
    message.includes('invalid_customer') ||
    message.includes('invalid_quote_validity') ||
    message.includes('invalid_quote_notes') ||
    message.includes('invalid_items') ||
    message.includes('duplicate_items') ||
    message.includes('invalid_product') ||
    message.includes('quantity_below_minimum') ||
    message.includes('quantity_not_multiple') ||
    message.includes('order_below_minimum') ||
    message.includes('order_too_large')
  ) {
    throw new HttpError(400, 'invalid_quote', 'Revise o cliente, os itens e a validade do orçamento.')
  }
  if (message.includes('forbidden')) {
    throw new HttpError(403, 'forbidden', 'Sem permissão para esta operação.')
  }

  throw new HttpError(500, 'quote_failed', 'Não foi possível concluir o orçamento.')
}
