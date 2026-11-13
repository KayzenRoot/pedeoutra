import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Settings } from './Settings'

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
  subscription: {
    id: 'sub-1',
    organization_id: 'org-1',
    state: 'active',
    plan_code: 'professional',
    plan_version: 1,
    current_period_end: '2026-12-13T12:00:00Z',
    last_verified_at: '2026-11-13T12:00:00Z',
  },
  refreshOrganization: vi.fn(),
}))

const supabaseMock = vi.hoisted(() => ({
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(),
      listFactors: vi.fn(),
    },
  },
}))

const edge = vi.hoisted(() => ({ getPlanCatalog: vi.fn() }))

vi.mock('../context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('../lib/supabase', () => ({
  supabase: supabaseMock,
  isBackendConfigured: true,
}))
vi.mock('../lib/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/edge')>()
  return { ...actual, getPlanCatalog: edge.getPlanCatalog }
})

describe('configurações da conta', () => {
  beforeEach(() => {
    supabaseMock.auth.mfa.getAuthenticatorAssuranceLevel.mockReset()
    supabaseMock.auth.mfa.listFactors.mockReset()
    supabaseMock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
    })
    supabaseMock.auth.mfa.listFactors.mockResolvedValue({ data: { totp: [] } })
    edge.getPlanCatalog.mockReset()
    edge.getPlanCatalog.mockResolvedValue({
      plans: [
        {
          plan_code: 'essential',
          plan_version: 1,
          price_cents: 2990,
          currency: 'BRL',
          trial_days: 7,
          available: true,
          unavailable_reason: null,
          features: [],
        },
        {
          plan_code: 'professional',
          plan_version: 1,
          price_cents: 6990,
          currency: 'BRL',
          trial_days: 0,
          available: false,
          unavailable_reason: 'PRO_PLAN_CHECKOUT_DISABLED',
          features: [
            {
              key: 'api_access',
              enabled: true,
              limit_value: 10000,
              limit_window: 'month',
            },
            { key: 'team', enabled: true, limit_value: 3, limit_window: 'total' },
          ],
        },
      ],
    })
  })

  it('mostra plano, limites, tema e integrações desabilitadas', async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Profissional' })).toBeInTheDocument()
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'DD' &&
          Boolean(element.textContent?.includes('10.000')) &&
          Boolean(element.textContent?.includes('por mês')),
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'DD' &&
          Boolean(element.textContent?.includes('3')) &&
          Boolean(element.textContent?.includes('no total')),
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Preferência de tema' })).toBeInTheDocument()
    expect(screen.getByText(/WhatsApp oficial:/i)).toBeInTheDocument()
    expect(screen.getByText(/API REST:/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Autenticação em dois fatores/i })).toBeInTheDocument()
  })

  it('mantém os dados da empresa editáveis', async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    )

    expect(await screen.findByDisplayValue('Distribuidora Teste')).toBeInTheDocument()
    expect(screen.getByDisplayValue('11999998888')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Salvar dados/i })).toBeEnabled()
  })
})
