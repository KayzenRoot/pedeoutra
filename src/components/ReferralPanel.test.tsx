import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReferralPanel } from './ReferralPanel'

const auth = vi.hoisted(() => ({
  organization: { id: 'org-1', name: 'Distribuidora Teste' },
}))

const supabaseMock = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('../lib/supabase', () => ({
  supabase: supabaseMock,
  isBackendConfigured: true,
}))

const CODE = {
  code: 'a'.repeat(24),
  link_path: `/criar-conta?ref=${'a'.repeat(24)}`,
  status: 'active',
  max_uses: 25,
  uses_count: 1,
  expires_at: '2027-05-01T12:00:00Z',
  created_at: '2026-11-01T12:00:00Z',
}

const REFERRAL = {
  referral_id: 'ref-1',
  display_label: 'Indicação abcdef12',
  status: 'reward_pending',
  review_required: false,
  reward_status: 'pending',
  reward_amount_cents: null,
  created_at: '2026-11-02T12:00:00Z',
  qualified_at: '2026-11-10T12:00:00Z',
  total_count: 1,
}

function rpcResult(name: string) {
  if (name === 'api_referral_code_get_or_create' || name === 'api_referral_code_rotate') {
    return Promise.resolve({ data: [CODE], error: null })
  }
  return Promise.resolve({ data: [REFERRAL], error: null })
}

describe('painel de indicações', () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset()
    supabaseMock.rpc.mockImplementation((name: string) => rpcResult(name))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('mostra link, status e recompensa pendente sem prometer crédito', async () => {
    render(<ReferralPanel />)

    expect(await screen.findByText('Indicação abcdef12')).toBeInTheDocument()
    expect(screen.getByText('Recompensa pendente')).toBeInTheDocument()
    expect(screen.getByText('Pendente de aprovação')).toBeInTheDocument()
    expect(screen.getByText(/Nenhum crédito/)).toBeInTheDocument()
    expect(screen.getByText(/1 de 25 usos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar link de indicação' })).toBeInTheDocument()
  })

  it('rotaciona o código revogando o anterior', async () => {
    const user = userEvent.setup()
    render(<ReferralPanel />)
    await screen.findByText('Indicação abcdef12')

    await user.click(screen.getByRole('button', { name: 'Gerar novo link' }))
    expect(supabaseMock.rpc).toHaveBeenCalledWith('api_referral_code_rotate', {
      p_organization_id: 'org-1',
    })
    expect(await screen.findByText(/O código anterior foi revogado/)).toBeInTheDocument()
  })
})
