import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/launch-info', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/launch-info')>()
  return { ...actual, LAUNCH_INFO: null }
})

import { Privacy, Terms } from './Legal'

describe('documentos legais sem identidade de lançamento', () => {
  it('mantém o aviso de documento preliminar no privacidade', () => {
    render(
      <MemoryRouter>
        <Privacy />
      </MemoryRouter>,
    )

    expect(screen.getByText('Documento preliminar')).toBeInTheDocument()
    expect(screen.getByText(/canal oficial de privacidade e suporte será publicado/i)).toBeInTheDocument()
    expect(screen.getByText('PedeOutra — MVP em validação.')).toBeInTheDocument()
  })

  it('não afirma que o Profissional está em preparação', () => {
    render(
      <MemoryRouter>
        <Terms />
      </MemoryRouter>,
    )

    expect(screen.getByText(/R\$ 69,90 por mês/i)).toBeInTheDocument()
    expect(screen.queryByText(/em preparação/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/não pode ser contratado/i)).not.toBeInTheDocument()
    expect(screen.getByText(/documento é preliminar/i)).toBeInTheDocument()
  })
})
