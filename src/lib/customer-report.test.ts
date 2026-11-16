import { describe, expect, it } from 'vitest'
import {
  buildCustomerReportCsv,
  csvCell,
  customerReportFilename,
  type CustomerInsightRow,
} from './customer-report'

const ROW: CustomerInsightRow = {
  customer_id: 'c1',
  display_name: '=HYPERLINK("http://evil.test")',
  contact_phone: null,
  valid_order_count: 2,
  last_order_at: '2026-10-01T12:00:00.000Z',
  days_since_last: 46,
  orders_value_cents: 2000,
  confirmed_value_cents: 1000,
  completed_value_cents: 1000,
  median_interval_days: 20,
  frequency_trend: 'stable',
  segment: 'inactive',
  total_count: 1,
}

describe('customer report CSV', () => {
  it('neutraliza fórmulas e aspas em todas as células', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"')
    expect(csvCell('+55 11')).toBe('"\'+55 11"')
    expect(csvCell('-10')).toBe('"\'-10"')
    expect(csvCell('@user')).toBe('"\'@user"')
    expect(csvCell('nome;com "aspas"')).toBe('"nome;com ""aspas"""')
    expect(csvCell(null)).toBe('""')
  })

  it('gera cabeçalho, BOM e linha sem telefone quando restrito', () => {
    const csv = buildCustomerReportCsv([ROW], 30)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Cliente";"Telefone";"Segmento"')
    expect(csv).toContain('Restrito ao seu papel')
    expect(csv).toContain('Inativo')
    expect(csv).toContain('"46"')
    expect(csv).toContain('"2000"')
    expect(csv).toContain('"30"')
  })

  it('nome do arquivo usa a data UTC estável', () => {
    expect(customerReportFilename(new Date('2026-11-16T23:00:00.000Z'))).toBe(
      'clientes-relatorio-2026-11-16.csv',
    )
  })
})
