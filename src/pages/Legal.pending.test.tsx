import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/launch-info', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/launch-info')>()
  return {
    ...actual,
    LAUNCH_INFO: {
      legalName: 'PedeOutra',
      taxId: '30.317.383/0001-97',
      supportEmail: 'suporte@pedeoutra.com.br',
      privacyEmail: 'admin@pedeoutra.com.br',
      updatedAt: '18/11/2026',
      legalReview: 'pending',
    },
  }
})

import { Privacy, Terms } from './Legal'

describe('documentos legais em revisão', () => {
  it('mostra CNPJ e contatos sem declarar documento vigente', () => {
    render(
      <MemoryRouter>
        <Privacy />
      </MemoryRouter>,
    )

    expect(screen.getByText('Documento em revisão')).toBeInTheDocument()
    expect(screen.getAllByText(/CNPJ 30\.317\.383\/0001-97/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Revisão jurídica humana pendente/i)).toBeInTheDocument()
    expect(screen.queryByText('Documento vigente')).not.toBeInTheDocument()
  })

  it('omite o endereço quando não foi definido', () => {
    render(
      <MemoryRouter>
        <Terms />
      </MemoryRouter>,
    )

    expect(screen.queryByText(/com endereço em/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Este documento está em revisão jurídica humana/i)).toBeInTheDocument()
  })
})
