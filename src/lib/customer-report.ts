import { formatBRL, formatDateTime, formatPhone } from './format'

export interface CustomerInsightRow {
  customer_id: string
  display_name: string
  contact_phone: string | null
  valid_order_count: number
  last_order_at: string | null
  days_since_last: number | null
  orders_value_cents: number
  confirmed_value_cents: number
  completed_value_cents: number
  median_interval_days: number | null
  frequency_trend: 'up' | 'down' | 'stable' | 'insufficient'
  segment:
    | 'no_purchases'
    | 'inactive'
    | 'regular'
    | 'overdue'
    | 'reactivated'
    | 'insufficient'
  total_count: number
}

export interface CustomerInsightsSummary {
  total_customers: number
  active_customers: number
  inactive_customers: number
  reactivated_customers: number
  no_purchase_customers: number
  insufficient_customers: number
  valid_order_count: number
  orders_value_cents: number
  confirmed_value_cents: number
  completed_value_cents: number
  inactive_days: number
  window_start: string
  generated_at: string
}

export const SEGMENT_LABELS: Record<CustomerInsightRow['segment'], string> = {
  no_purchases: 'Sem compras válidas',
  inactive: 'Inativo',
  regular: 'Regular',
  overdue: 'Atrasado',
  reactivated: 'Reativado',
  insufficient: 'Histórico curto',
}

export const TREND_LABELS: Record<CustomerInsightRow['frequency_trend'], string> = {
  up: 'Acelerando',
  down: 'Desacelerando',
  stable: 'Estável',
  insufficient: '—',
}

const SEGMENT_OPTIONS: Array<{ value: CustomerInsightRow['segment'] | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'overdue', label: 'Atrasados' },
  { value: 'regular', label: 'Regulares' },
  { value: 'reactivated', label: 'Reativados' },
  { value: 'no_purchases', label: 'Sem compras' },
  { value: 'insufficient', label: 'Histórico curto' },
]

export { SEGMENT_OPTIONS }

/**
 * Célula CSV segura: neutraliza fórmulas e sempre entrega texto entre aspas.
 * Pedidos são valores comerciais; nunca rotular como receita recebida.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function buildCustomerReportCsv(
  rows: CustomerInsightRow[],
  inactiveDays: number,
): string {
  const header = [
    'Cliente',
    'Telefone',
    'Segmento',
    'Último pedido válido',
    'Dias desde o último pedido',
    'Pedidos confirmados/concluídos',
    'Valor em pedidos (centavos)',
    'Valor confirmado (centavos)',
    'Valor concluído (centavos)',
    'Intervalo mediano (dias)',
    'Tendência de frequência',
    'Janela de inatividade (dias)',
  ]
  const lines = rows.map((row) =>
    [
      row.display_name,
      row.contact_phone ? formatPhone(row.contact_phone) : 'Restrito ao seu papel',
      SEGMENT_LABELS[row.segment],
      row.last_order_at ? formatDateTime(row.last_order_at) : '',
      row.days_since_last,
      row.valid_order_count,
      row.orders_value_cents,
      row.confirmed_value_cents,
      row.completed_value_cents,
      row.median_interval_days,
      TREND_LABELS[row.frequency_trend],
      inactiveDays,
    ]
      .map(csvCell)
      .join(';'),
  )
  return `\uFEFF${header.map(csvCell).join(';')}\r\n${lines.join('\r\n')}\r\n`
}

export function customerReportFilename(date: Date): string {
  const stamp = date.toISOString().slice(0, 10)
  return `clientes-relatorio-${stamp}.csv`
}

export function formatReportValue(cents: number): string {
  return formatBRL(cents)
}
