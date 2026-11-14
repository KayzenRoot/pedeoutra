import { HttpError } from './http.ts'

interface QuoteErrorRule {
  match: string
  status: number
  code: string
  message: string
}

const RULES: QuoteErrorRule[] = [
  { match: 'rate_limited', status: 429, code: 'rate_limited', message: 'Muitas tentativas. Aguarde alguns minutos.' },
  { match: 'plan_required', status: 403, code: 'plan_required', message: 'Esta funcionalidade exige o plano Profissional ativo.' },
  { match: 'organization_unavailable', status: 409, code: 'catalog_unavailable', message: 'O acesso do fornecedor está pausado.' },
  { match: 'quote_link_unavailable', status: 404, code: 'quote_link_unavailable', message: 'Este link de orçamento não está disponível.' },
  { match: 'quote_expired', status: 410, code: 'quote_expired', message: 'Este orçamento expirou. Peça uma nova proposta.' },
  { match: 'quote_stale', status: 409, code: 'quote_stale', message: 'Os preços ou condições mudaram. O fornecedor precisa revisar o orçamento.' },
  { match: 'quote_product_inactive', status: 409, code: 'quote_product_inactive', message: 'Um produto deste orçamento não está mais disponível. Peça uma revisão.' },
  { match: 'quote_not_open', status: 409, code: 'quote_not_open', message: 'Este orçamento não está mais aberto para aceite.' },
  { match: 'quote_not_editable', status: 409, code: 'quote_not_editable', message: 'Este orçamento já foi enviado e não pode ser editado.' },
  { match: 'quote_not_cancelable', status: 409, code: 'quote_not_cancelable', message: 'Este orçamento não pode mais ser cancelado.' },
  { match: 'quote_version_conflict', status: 409, code: 'quote_version_conflict', message: 'O orçamento mudou. Recarregue a página.' },
  { match: 'quote_not_found', status: 404, code: 'quote_not_found', message: 'Orçamento não encontrado.' },
  { match: 'quote_price_missing', status: 409, code: 'quote_price_missing', message: 'Defina um preço para todos os itens antes de criar o orçamento.' },
  { match: 'request_conflict', status: 409, code: 'request_conflict', message: 'Requisição conflitante. Recarregue a página.' },
  { match: 'forbidden', status: 403, code: 'forbidden', message: 'Sem permissão para esta operação.' },
]

const INVALID_INPUT = [
  'invalid_customer',
  'invalid_quote_validity',
  'invalid_quote_notes',
  'invalid_items',
  'duplicate_items',
  'invalid_product',
  'quantity_below_minimum',
  'quantity_not_multiple',
  'order_below_minimum',
  'order_too_large',
]

/**
 * Converte erros dos RPCs de orçamento em respostas HTTP estáveis.
 * Nenhum detalhe interno do banco é exposto ao comprador ou ao fornecedor.
 */
export function throwQuoteError(error: { message?: string } | null): never {
  const message = error?.message ?? ''
  const rule = RULES.find((candidate) => message.includes(candidate.match))
  if (rule) throw new HttpError(rule.status, rule.code, rule.message)
  if (INVALID_INPUT.some((candidate) => message.includes(candidate))) {
    throw new HttpError(400, 'invalid_quote', 'Revise o cliente, os itens e a validade do orçamento.')
  }
  throw new HttpError(500, 'quote_failed', 'Não foi possível concluir o orçamento.')
}
