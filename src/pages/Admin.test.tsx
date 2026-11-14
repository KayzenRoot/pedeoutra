import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Admin } from './Admin'

const auth = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  signOut: vi.fn(),
}))

const supabaseMock = vi.hoisted(() => ({
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(),
      listFactors: vi.fn(),
      enroll: vi.fn(),
      challenge: vi.fn(),
      verify: vi.fn(),
    },
  },
}))

const edge = vi.hoisted(() => ({
  callAuthedGet: vi.fn(),
  callAuthedFunction: vi.fn(),
}))

vi.mock('../context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('../lib/supabase', () => ({
  supabase: supabaseMock,
  isBackendConfigured: true,
}))
vi.mock('../lib/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/edge')>()
  return {
    ...actual,
    callAuthedGet: edge.callAuthedGet,
    callAuthedFunction: edge.callAuthedFunction,
  }
})

const overview = {
  organizations_total: 1,
  trials_active: 1,
  trials_review: 0,
  subscriptions_active: 0,
  subscriptions_past_due: 0,
  subscriptions_canceled: 0,
  subscriptions_refunded: 0,
  organizations_blocked: 0,
  confirmed_revenue_cents: 0,
}

const organization = {
  organization_id: 'org-1',
  name: 'Distribuidora Teste',
  slug: 'distribuidora-teste',
  access_state: 'trial',
  trial_ends_at: '2026-11-20T12:00:00Z',
  trial_status: 'granted',
  risk_score: 0,
  created_at: '2026-11-13T12:00:00Z',
  plan_code: 'essential',
  plan_version: 1,
  subscription_state: null,
  current_period_end: null,
  total_count: 1,
}

describe('console administrativo', () => {
  beforeEach(() => {
    auth.session = { access_token: 'token' }
    supabaseMock.auth.mfa.getAuthenticatorAssuranceLevel.mockReset()
    supabaseMock.auth.mfa.listFactors.mockReset()
    supabaseMock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
    })
    supabaseMock.auth.mfa.listFactors.mockResolvedValue({
      data: { totp: [] },
    })
    edge.callAuthedGet.mockReset()
    edge.callAuthedFunction.mockReset()
  })

  it('pede login quando não há sessão', () => {
    auth.session = null
    render(
      <MemoryRouter>
        <Admin />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /Console administrativo/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute(
      'href',
      '/entrar?next=/admin',
    )
  })

  it('exige MFA antes de chamar qualquer endpoint global', async () => {
    render(
      <MemoryRouter>
        <Admin />
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('heading', { name: /Confirme o MFA TOTP/i }),
    ).toBeInTheDocument()
    expect(edge.callAuthedGet).not.toHaveBeenCalled()
  })

  it('mostra overview, organizações e auditoria com AAL2', async () => {
    supabaseMock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    })
    edge.callAuthedGet.mockImplementation(
      (_name: string, query: Record<string, string | number | undefined>) => {
        if (query.view === 'overview') return Promise.resolve({ overview })
        if (query.view === 'organizations') {
          return Promise.resolve({ organizations: [organization], total: 1 })
        }
        if (query.view === 'analytics') {
          return Promise.resolve({ days: 30, events: [], sources: [] })
        }
        return Promise.resolve({
          audit: [
            {
              id: 'audit-1',
              actor_user_id: 'admin-1',
              action: 'admin.console.access',
              target_organization_id: null,
              reason: null,
              status: 'ok',
              created_at: '2026-11-13T12:00:00Z',
              total_count: 1,
            },
          ],
          total: 1,
        })
      },
    )

    render(
      <MemoryRouter>
        <Admin />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('Distribuidora Teste', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Organizações' })).toBeInTheDocument()
    expect(screen.getByText('Ações administrativas recentes')).toBeInTheDocument()
    expect(screen.getByText('admin.console.access')).toBeInTheDocument()
  })

  it('falha fechado quando o bootstrap não está configurado', async () => {
    supabaseMock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    })
    const { EdgeFunctionError } = await import('../lib/edge')
    edge.callAuthedGet.mockRejectedValue(
      new EdgeFunctionError('ADMIN_BOOTSTRAP_BLOCKED', 'bloqueado', 503),
    )

    render(
      <MemoryRouter>
        <Admin />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText(/Console indisponível/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  })
})
