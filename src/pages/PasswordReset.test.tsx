import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForgotPassword } from './ForgotPassword'
import { ResetPassword } from './ResetPassword'

const auth = vi.hoisted(() => ({
  configured: true,
  loading: false,
  session: null as unknown,
  organization: null,
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
}))

vi.mock('../context/auth-context', () => ({
  useAuth: () => auth,
}))

function renderRoute(element: ReactNode) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {element}
    </MemoryRouter>,
  )
}

describe('recuperação de senha', () => {
  beforeEach(() => {
    auth.session = null
    auth.requestPasswordReset.mockReset()
    auth.requestPasswordReset.mockResolvedValue(undefined)
    auth.updatePassword.mockReset()
    auth.updatePassword.mockResolvedValue(undefined)
  })

  it('solicita o link e mostra mensagem genérica', async () => {
    const user = userEvent.setup()
    renderRoute(<ForgotPassword />)

    await user.type(screen.getByLabelText('E-mail'), 'teste@pedeoutra.test')
    await user.click(screen.getByRole('button', { name: /Enviar link de recuperação/i }))

    expect(auth.requestPasswordReset).toHaveBeenCalledWith('teste@pedeoutra.test')
    expect(screen.getByText(/Se este e-mail estiver cadastrado/i)).toBeInTheDocument()
  })

  it('mostra link inválido quando não há sessão de recuperação', () => {
    renderRoute(<ResetPassword />)

    expect(screen.getByRole('heading', { name: /Link inválido ou expirado/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Solicitar novo link/i })).toHaveAttribute(
      'href',
      '/recuperar-senha',
    )
  })

  it('bloqueia senhas diferentes antes de chamar o backend', async () => {
    auth.session = {}
    const user = userEvent.setup()
    renderRoute(<ResetPassword />)

    await user.type(screen.getByLabelText('Nova senha'), 'Senha123!')
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'Senha456!')
    await user.click(screen.getByRole('button', { name: /Salvar nova senha/i }))

    expect(screen.getByText(/As senhas não coincidem/i)).toBeInTheDocument()
    expect(auth.updatePassword).not.toHaveBeenCalled()
  })
})
