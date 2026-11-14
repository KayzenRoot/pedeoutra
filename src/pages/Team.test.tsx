import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Team } from './Team'

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
  membershipRole: 'owner',
}))

const edge = vi.hoisted(() => ({
  callAuthedGet: vi.fn(),
  callAuthedFunction: vi.fn(),
}))

vi.mock('../context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('../lib/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/edge')>()
  return {
    ...actual,
    callAuthedGet: edge.callAuthedGet,
    callAuthedFunction: edge.callAuthedFunction,
  }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <Team />
    </MemoryRouter>,
  )
}

describe('equipe', () => {
  beforeEach(() => {
    edge.callAuthedGet.mockReset()
    edge.callAuthedFunction.mockReset()
    auth.membershipRole = 'owner'
  })

  it('lista membros e convites para o proprietário', async () => {
    edge.callAuthedGet.mockResolvedValue({
      members: [
        {
          id: 'member-owner',
          email: 'owner@example.test',
          role: 'owner',
          status: 'active',
          created_at: '2026-11-13T12:00:00Z',
          revoked_at: null,
        },
        {
          id: 'member-1',
          email: 'manager@example.test',
          role: 'manager',
          status: 'active',
          created_at: '2026-11-13T12:00:00Z',
          revoked_at: null,
        },
      ],
      invitations: [
        {
          id: 'invite-1',
          email: 'invite@example.test',
          role: 'operator',
          expires_at: '2026-11-21T12:00:00Z',
          created_at: '2026-11-14T12:00:00Z',
          accepted_at: null,
          revoked_at: null,
        },
      ],
      limit: 3,
    })
    renderPage()

    expect(await screen.findByText('manager@example.test')).toBeInTheDocument()
    expect(screen.getByText('invite@example.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar link de convite' })).toBeInTheDocument()
  })

  it('bloqueia gestão para quem não é proprietário', () => {
    auth.membershipRole = 'manager'
    renderPage()

    expect(
      screen.getByRole('heading', { name: 'Apenas o proprietário gerencia a equipe' }),
    ).toBeInTheDocument()
    expect(edge.callAuthedGet).not.toHaveBeenCalled()
  })
})
