import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerReport } from './CustomerReport'

const auth = vi.hoisted(() => ({
  organization: { id: 'org-1', name: 'Distribuidora Teste' },
  subscription: { plan_code: 'professional', state: 'active' } as Record<string, unknown> | null,
  membershipRole: 'owner',
}))

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('../lib/supabase', () => ({
  supabase: supabaseMock,
  isBackendConfigured: true,
}))

const INSIGHT = {
  customer_id: 'customer-1',
  display_name: 'Padaria Inativa',
  contact_phone: '11977776666',
  valid_order_count: 3,
  last_order_at: '2026-10-01T12:00:00Z',
  days_since_last: 46,
  orders_value_cents: 12500,
  confirmed_value_cents: 5000,
  completed_value_cents: 7500,
  median_interval_days: 15,
  frequency_trend: 'down' as const,
  segment: 'inactive' as const,
  total_count: 1,
}

const SUMMARY = {
  total_customers: 4,
  active_customers: 1,
  inactive_customers: 2,
  reactivated_customers: 1,
  no_purchase_customers: 1,
  insufficient_customers: 1,
  valid_order_count: 9,
  orders_value_cents: 32500,
  confirmed_value_cents: 15000,
  completed_value_cents: 17500,
  inactive_days: 30,
  window_start: '2026-10-17T03:00:00Z',
  generated_at: '2026-11-16T12:00:00Z',
}

function rpcResult(name: string) {
  if (name === 'api_customer_insights_summary') return Promise.resolve({ data: [SUMMARY], error: null })
  if (name === 'api_customer_order_history') {
    return Promise.resolve({
      data: [
        {
          order_id: 'order-1',
          public_reference: 'PD-ABC123',
          status: 'completed',
          total_cents: 7500,
          item_count: 2,
          created_at: '2026-10-01T12:00:00Z',
          total_count: 1,
        },
      ],
      error: null,
    })
  }
  return Promise.resolve({ data: [INSIGHT], error: null })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomerReport />
    </MemoryRouter>,
  )
}

describe('relatório de clientes', () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset()
    auth.subscription = { plan_code: 'professional', state: 'active' }
    supabaseMock.rpc.mockImplementation((name: string) => rpcResult(name))
  })

  it('mostra métricas, valor em pedidos e histórico do cliente', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Padaria Inativa')).toBeInTheDocument()
    expect(screen.getByText('Inativo')).toBeInTheDocument()
    expect(screen.getByText('R$ 125,00')).toBeInTheDocument()
    expect(screen.getByText(/não é receita recebida/)).toBeInTheDocument()
    expect(screen.getByText(/Conf\. R\$ 50,00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Histórico' }))
    expect(await screen.findByText('PD-ABC123')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir' })).toHaveAttribute(
      'href',
      '/app/pedidos/order-1',
    )
  })

  it('mostra upsell no Essencial sem chamar o servidor', () => {
    auth.subscription = { plan_code: 'essential', state: 'active' }
    renderPage()

    expect(
      screen.getByRole('heading', { level: 2, name: 'Relatório de clientes' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Conhecer o Profissional' })).toBeInTheDocument()
    expect(supabaseMock.rpc).not.toHaveBeenCalled()
  })
})
