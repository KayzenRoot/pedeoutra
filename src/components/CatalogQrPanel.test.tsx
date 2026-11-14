import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CatalogQrPanel } from './CatalogQrPanel'

describe('painel de QR Code', () => {
  it('mostra QR, URL textual e aviso de segurança', () => {
    render(<CatalogQrPanel slug="distribuidora-teste" organizationName="Distribuidora Teste" />)

    expect(
      screen.getByAltText('QR Code do catálogo de Distribuidora Teste'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/\/c\/distribuidora-teste$/),
    ).toBeInTheDocument()
    expect(screen.getByText(/não dá acesso à conta/i)).toBeInTheDocument()
  })

  it('copia o link e dá feedback', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    render(<CatalogQrPanel slug="loja-teste" organizationName="Loja Teste" />)

    await user.click(screen.getByRole('button', { name: 'Copiar link' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/c/loja-teste'))
    expect(await screen.findByText('Link copiado.')).toBeInTheDocument()
  })

  it('não quebra quando clipboard é negado', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    render(<CatalogQrPanel slug="loja-teste" organizationName="Loja Teste" />)

    await user.click(screen.getByRole('button', { name: 'Copiar link' }))
    expect(
      await screen.findByText(/Selecione o link abaixo/i),
    ).toBeInTheDocument()
  })
})
