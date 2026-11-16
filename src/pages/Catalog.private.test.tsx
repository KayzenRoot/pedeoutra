import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from './Catalog'

const edge = vi.hoisted(() => ({
  getPrivateCatalog: vi.fn(),
  callPublicFunction: vi.fn(),
}))

vi.mock('../lib/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/edge')>()
  return {
    ...actual,
    getPrivateCatalog: edge.getPrivateCatalog,
    callPublicFunction: edge.callPublicFunction,
  }
})

const privateCatalog = {
  organization: {
    name: 'Distribuidora Teste',
    slug: 'distribuidora-teste',
    city: 'São Paulo',
    whatsapp: '11999998888',
    min_order_cents: null,
    min_order_items: null,
  },
  customer: { name: 'Padaria Edge' },
  price_list: { id: 'list-1', name: 'Tabela Ouro' },
  categories: [],
  products: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Copo 200ml',
      unit: 'cento',
      price_cents: 1000,
      price_source: 'private',
      sku: 'COPO-200',
      min_quantity: 1,
      quantity_increment: 1,
      category_id: null,
      images: [],
    },
  ],
  accepting_orders: true,
  expires_at: '2026-12-14T12:00:00Z',
}

function renderPrivate() {
  return render(
    <MemoryRouter initialEntries={['/p/token-teste']}>
      <Routes>
        <Route path="/p/:token" element={<Catalog />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('catálogo com preço privado', () => {
  beforeEach(() => {
    edge.getPrivateCatalog.mockReset()
    edge.callPublicFunction.mockReset()
  })

  it('mostra a tabela, não pede PII e envia o token no pedido', async () => {
    const user = userEvent.setup()
    edge.getPrivateCatalog.mockResolvedValue(privateCatalog)
    edge.callPublicFunction.mockResolvedValue({
      status: 'submitted',
      public_reference: 'PD-PRIVADO1',
      total_cents: 1000,
      item_count: 1,
    })

    renderPrivate()
    expect(await screen.findByText(/Preços exclusivos para Padaria Edge/)).toBeInTheDocument()
    expect(screen.getByText('Preço especial')).toBeInTheDocument()
    expect(screen.queryByLabelText('Seu nome ou empresa')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Telefone comercial')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Adicionar' })[0])
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Enviar pedido para análise' }))

    expect(await screen.findByText('PD-PRIVADO1')).toBeInTheDocument()
    expect(edge.getPrivateCatalog).toHaveBeenCalledWith('token-teste')
    expect(edge.callPublicFunction).toHaveBeenCalledWith(
      'public-order',
      expect.objectContaining({
        slug: 'distribuidora-teste',
        price_token: 'token-teste',
        buyer_name: undefined,
        buyer_phone: undefined,
        consent: true,
      }),
    )
  })

  it('falha de forma neutra quando o link expirou', async () => {
    edge.getPrivateCatalog.mockRejectedValue(new Error('404'))
    renderPrivate()

    expect(
      await screen.findByRole('heading', { name: 'Link de preços indisponível' }),
    ).toBeInTheDocument()
  })
})
