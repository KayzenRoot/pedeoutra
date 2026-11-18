import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/launch-info', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/launch-info')>()
  return {
    ...actual,
    LAUNCH_INFO: {
      legalName: 'PedeOutra Tecnologia Ltda.',
      taxId: '00.000.000/0001-00',
      address: 'Rua Exemplo, 1, São Paulo/SP',
      supportEmail: 'suporte@pedeoutra.com.br',
      privacyEmail: 'privacidade@pedeoutra.com.br',
      updatedAt: '18/11/2026',
      legalReview: 'approved',
    },
  }
})

import { Privacy, Terms } from './Legal'

describe('documentos legais com identidade de lançamento', () => {
  it('mostra razão social, CNPJ e canal de privacidade', () => {
    render(
      <MemoryRouter>
        <Privacy />
      </MemoryRouter>,
    )

    expect(screen.getByText('Documento vigente')).toBeInTheDocument()
    expect(screen.getByText(/Aprovação do proprietário/i)).toBeInTheDocument()
    expect(screen.getAllByText(/PedeOutra Tecnologia Ltda\./).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/00\.000\.000\/0001-00/).length).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('link', { name: 'privacidade@pedeoutra.com.br' }).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Documento preliminar')).not.toBeInTheDocument()
  })

  it('mostra contato e remove o aviso preliminar dos termos', () => {
    render(
      <MemoryRouter>
        <Terms />
      </MemoryRouter>,
    )

    expect(screen.getByText('Documento vigente')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '9. Contato' })).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: 'suporte@pedeoutra.com.br' }).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/documento é preliminar/i)).not.toBeInTheDocument()
  })
})
