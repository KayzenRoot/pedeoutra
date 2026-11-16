import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivatePrices } from './PrivatePrices'

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
  },
  subscription: null as Record<string, unknown> | null,
  user: { id: 'user-1' },
}))

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('../context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('../lib/supabase', () => ({
  supabase: supabaseMock,
  isBackendConfigured: true,
}))

function builder(data: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
  }
  return chain
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PrivatePrices />
    </MemoryRouter>,
  )
}

describe('preços por comprador', () => {
  beforeEach(() => {
    supabaseMock.from.mockReset()
    auth.subscription = null
  })

  it('mostra upsell quando o plano não é Profissional', () => {
    auth.subscription = { plan_code: 'essential', state: 'active' }
    renderPage()

    expect(screen.getByRole('heading', { name: 'Preço especial por cliente' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Conhecer o Profissional' })).toBeInTheDocument()
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('carrega tabelas vazias no Profissional', async () => {
    auth.subscription = {
      plan_code: 'professional',
      state: 'active',
      current_period_end: '2026-12-13T12:00:00Z',
    }
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'customers') {
        return builder([
          {
            id: 'customer-1',
            organization_id: 'org-1',
            display_name: 'Padaria Edge',
            contact_phone: '11977776666',
            created_at: '2026-11-13T12:00:00Z',
            updated_at: '2026-11-13T12:00:00Z',
          },
        ])
      }
      return builder([])
    })

    renderPage()
    expect(await screen.findByText('Nenhuma tabela ainda')).toBeInTheDocument()
    expect(screen.getByText('Padaria Edge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar tabela' })).toBeEnabled()
  })
})
