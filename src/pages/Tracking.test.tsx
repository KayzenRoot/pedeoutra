import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tracking } from './Tracking'

const edge = vi.hoisted(() => ({ getOrderTracking: vi.fn() }))

vi.mock('../lib/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/edge')>()
  return { ...actual, getOrderTracking: edge.getOrderTracking }
})

function renderTracking(token = 'token-teste') {
  return render(
    <MemoryRouter initialEntries={[`/acompanhar/${token}`]}>
      <Routes>
        <Route path="/acompanhar/:token" element={<Tracking />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('acompanhamento público', () => {
  beforeEach(() => {
    edge.getOrderTracking.mockReset()
  })

  it('mostra status, itens e timeline sem PII', async () => {
    edge.getOrderTracking.mockResolvedValue({
      supplier: { name: 'Distribuidora Teste', slug: 'distribuidora-teste' },
      reference: 'PD-ABC123',
      status: 'confirmed',
      created_at: '2026-11-14T12:00:00Z',
      items: [{ name: 'Copo 200ml', quantity: 2 }],
      timeline: [
        { status: 'new', at: '2026-11-14T12:00:00Z' },
        { status: 'confirmed', at: '2026-11-14T13:00:00Z' },
      ],
      expires_at: '2026-12-14T12:00:00Z',
    })

    renderTracking()
    expect(await screen.findByText('PD-ABC123')).toBeInTheDocument()
    expect(screen.getByText('Distribuidora Teste')).toBeInTheDocument()
    expect(screen.getByText('Copo 200ml')).toBeInTheDocument()
    expect(screen.getAllByText('Confirmado pelo fornecedor').length).toBeGreaterThan(0)
    expect(screen.queryByText(/telefone do comprador/i)).not.toBeInTheDocument()
  })

  it('falha de forma neutra para token inválido', async () => {
    edge.getOrderTracking.mockRejectedValue(new Error('404'))
    renderTracking('invalido')

    expect(
      await screen.findByRole('heading', { name: /Link inválido ou expirado/i }),
    ).toBeInTheDocument()
  })
})
