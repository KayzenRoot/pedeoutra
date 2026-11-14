import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuotePublic } from './QuotePublic'

const edge = vi.hoisted(() => ({
  getPublicQuote: vi.fn(),
  callPublicFunction: vi.fn(),
}))

vi.mock('../lib/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/edge')>()
  return {
    ...actual,
    getPublicQuote: edge.getPublicQuote,
    callPublicFunction: edge.callPublicFunction,
  }
})

const quote = {
  supplier: { name: 'Distribuidora Teste', slug: 'distribuidora-teste', whatsapp: '11999998888' },
  customer: { name: 'Padaria Edge' },
  reference: 'OR-ABC123',
  status: 'sent',
  valid_until: '2026-11-21T23:59:59Z',
  notes: 'Entrega em 3 dias',
  items: [
    {
      name: 'Copo 200ml',
      unit: 'cento',
      quantity: 2,
      unit_price_cents: 1000,
      subtotal_cents: 2000,
    },
  ],
  total_cents: 2000,
  created_at: '2026-11-14T12:00:00Z',
  order_reference: null,
  can_accept: true,
}

function renderQuote() {
  return render(
    <MemoryRouter initialEntries={['/o/token-teste']}>
      <Routes>
        <Route path="/o/:token" element={<QuotePublic />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('orçamento público', () => {
  beforeEach(() => {
    edge.getPublicQuote.mockReset()
    edge.callPublicFunction.mockReset()
  })

  it('mostra itens sem PII e aceita com confirmação explícita', async () => {
    const user = userEvent.setup()
    edge.getPublicQuote.mockResolvedValue(quote)
    edge.callPublicFunction.mockResolvedValue({
      status: 'accepted',
      order_reference: 'PD-QUOTE1',
      quote_reference: 'OR-ABC123',
      total_cents: 2000,
      item_count: 1,
      already_accepted: false,
    })

    renderQuote()
    expect(await screen.findByText('OR-ABC123')).toBeInTheDocument()
    expect(screen.getByText('Copo 200ml')).toBeInTheDocument()
    expect(screen.getByText('Entrega em 3 dias')).toBeInTheDocument()
    expect(screen.queryByText(/11977776666/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox'))
    const acceptButton = screen.getByRole('button', { name: 'Aceitar orçamento' })
    await waitFor(() => expect(acceptButton).toBeEnabled())
    await user.click(acceptButton)

    expect(await screen.findByText(/PD-QUOTE1/)).toBeInTheDocument()
    expect(edge.getPublicQuote).toHaveBeenCalledWith('token-teste')
    expect(edge.callPublicFunction).toHaveBeenCalledWith(
      'quote-accept',
      expect.objectContaining({
        token: 'token-teste',
        confirm: true,
        request_id: expect.any(String),
      }),
    )
  })

  it('não oferece aceite quando o orçamento foi recusado', async () => {
    edge.getPublicQuote.mockResolvedValue({
      ...quote,
      status: 'declined',
      can_accept: false,
    })
    renderQuote()

    expect(await screen.findByText('OR-ABC123')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aceitar orçamento' })).not.toBeInTheDocument()
    expect(
      screen.getByText(/não está mais aberto para aceite/i),
    ).toBeInTheDocument()
  })
})
