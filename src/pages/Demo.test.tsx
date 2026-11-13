import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Demo } from './Demo'

describe('demonstração pública', () => {
  it('mostra catálogo fictício e não chama backend', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Demo />
      </MemoryRouter>,
    )

    expect(screen.getByText('Bella Limpeza')).toBeInTheDocument()
    expect(screen.getAllByText(/dados fictícios/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/pedido demonstrativo enviado/i)).not.toBeInTheDocument()
  })

  it('simula envio com sucesso e deixa claro que nada foi enviado', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Demo />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/nome fictício/i), 'Empresa de Teste')
    await user.click(
      screen.getByLabelText(/entendo que esta é uma simulação/i),
    )
    await user.click(screen.getByRole('button', { name: /simular envio do pedido/i }))

    expect(screen.getByText(/pedido demonstrativo enviado/i)).toBeInTheDocument()
    expect(screen.getByText(/nenhum pedido foi enviado/i)).toBeInTheDocument()
    expect(screen.getByText('DEMO-8F2A11')).toBeInTheDocument()
  })
})
