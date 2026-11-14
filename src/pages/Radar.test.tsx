import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Radar } from './Radar'

const auth = vi.hoisted(() => ({
  organization: {
    id: 'org-1',
    name: 'Distribuidora Teste',
    slug: 'distribuidora-teste',
    whatsapp: '11999998888',
    city: 'São Paulo',
    trial_ends_at: '2026-11-20T12:00:00Z',
    access_state: 'active',
    owner_user_id: 'user-1',
    created_at: '2026-11-13T12:00:00Z',
    updated_at: '2026-11-13T12:00:00Z',
    reorder_reminder_enabled: true,
  },
  subscription: { plan_code: 'professional', state: 'active' } as Record<string, unknown> | null,
  membershipRole: 'owner',
}))

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('../lib/supabase', () => ({
  supabase: supabaseMock,
  isBackendConfigured: true,
}))

function remindersBuilder(data: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
  }
  return chain
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Radar />
    </MemoryRouter>,
  )
}

describe('radar de recompra', () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset()
    supabaseMock.from.mockReset()
    auth.subscription = { plan_code: 'professional', state: 'active' }
  })

  it('mostra cliente atrasado e ação manual', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        {
          customer_id: 'customer-1',
          display_name: 'Padaria Atrasada',
          contact_phone: '11977776666',
          valid_order_count: 4,
          last_order_at: '2026-10-01T12:00:00Z',
          median_interval_days: 10,
          next_expected_at: '2026-10-11T12:00:00Z',
          days_since_last: 44,
          overdue: true,
          insufficient: false,
          snoozed_until: null,
          total_count: 1,
        },
      ],
      error: null,
    })
    supabaseMock.from.mockReturnValue(remindersBuilder([]))

    renderPage()
    expect(await screen.findByText('Padaria Atrasada')).toBeInTheDocument()
    expect(screen.getByText('Atrasado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lembrar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Silenciar 30d' })).toBeInTheDocument()
  })

  it('mostra upsell no Essencial', () => {
    auth.subscription = { plan_code: 'essential', state: 'active' }
    renderPage()

    expect(screen.getByRole('heading', { level: 2, name: 'Radar de recompra' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Conhecer o Profissional' })).toBeInTheDocument()
    expect(supabaseMock.rpc).not.toHaveBeenCalled()
  })
})
