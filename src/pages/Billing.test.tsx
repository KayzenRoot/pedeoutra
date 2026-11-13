import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Billing } from './Billing'

const auth = vi.hoisted(() => ({
  organization: {
    id: 'org-1',
    name: 'Distribuidora Teste',
    slug: 'distribuidora-teste',
    whatsapp: '11999998888',
    city: 'São Paulo',
    trial_ends_at: '2026-11-20T12:00:00Z',
    access_state: 'trial',
    owner_user_id: 'user-1',
    created_at: '2026-11-13T12:00:00Z',
    updated_at: '2026-11-13T12:00:00Z',
  },
  subscription: null as Record<string, unknown> | null,
  refreshOrganization: vi.fn(),
}))

const edge = vi.hoisted(() => ({
  getPlanCatalog: vi.fn(),
  callAuthedFunction: vi.fn(),
}))

vi.mock('../context/auth-context', () => ({ useAuth: () => auth }))

vi.mock('../lib/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/edge')>()
  return {
    ...actual,
    getPlanCatalog: edge.getPlanCatalog,
    callAuthedFunction: edge.callAuthedFunction,
  }
})

const plans = [
  {
    plan_code: 'essential' as const,
    plan_version: 1,
    price_cents: 2990,
    currency: 'BRL',
    trial_days: 7,
    available: true,
    unavailable_reason: null,
    features: [
      { key: 'catalog_public', enabled: true, limit_value: null, limit_window: null },
      { key: 'orders', enabled: true, limit_value: null, limit_window: null },
    ],
  },
  {
    plan_code: 'professional' as const,
    plan_version: 1,
    price_cents: 6990,
    currency: 'BRL',
    trial_days: 0,
    available: false,
    unavailable_reason: 'PRO_PLAN_CHECKOUT_DISABLED',
    features: [
      { key: 'api_access', enabled: true, limit_value: 10000, limit_window: 'month' },
    ],
  },
]

describe('assinatura e planos', () => {
  beforeEach(() => {
    auth.subscription = null
    edge.getPlanCatalog.mockReset()
    edge.callAuthedFunction.mockReset()
    edge.getPlanCatalog.mockResolvedValue({ plans })
  })

  it('mostra Essencial disponível e Profissional em preparação', async () => {
    render(
      <MemoryRouter>
        <Billing />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Essencial' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Profissional' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assinar Essencial por/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Indisponível nesta fase/i })).toBeDisabled()
    expect(screen.getAllByText(/Em preparação/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Recursos previstos, ainda não contratáveis/i)).toBeInTheDocument()
  })

  it('não oferece contratação quando o catálogo falha', async () => {
    edge.getPlanCatalog.mockRejectedValue(new Error('offline'))
    render(
      <MemoryRouter>
        <Billing />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText(/Não foi possível carregar os planos agora/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assinar Essencial/i })).not.toBeInTheDocument()
  })

  it('mostra o plano atual quando a assinatura está ativa', async () => {
    auth.subscription = {
      id: 'sub-1',
      organization_id: 'org-1',
      state: 'active',
      plan_code: 'essential',
      plan_version: 1,
      current_period_end: '2026-12-13T12:00:00Z',
      last_verified_at: '2026-11-13T12:00:00Z',
    }
    render(
      <MemoryRouter>
        <Billing />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: 'Plano atual' })).toBeDisabled()
    expect(screen.getByText('Essencial', { selector: 'dd' })).toBeInTheDocument()
  })
})
