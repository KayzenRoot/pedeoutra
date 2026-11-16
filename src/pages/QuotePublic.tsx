import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { FormMessage, LoadingScreen } from '../components/ui'
import { callPublicFunction, getPublicQuote } from '../lib/edge'
import { formatBRL, formatDateTime, whatsappLink } from '../lib/format'
import type { PublicQuoteResponse, QuoteAcceptResponse } from '../lib/types'

const STATUS_TEXT: Record<string, string> = {
  sent: 'Aguardando seu aceite',
  accepted: 'Aceito',
  declined: 'Recusado',
  expired: 'Expirado',
  canceled: 'Cancelado',
  draft: 'Em preparação',
}

function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status
}

function statusBadgeClass(status: string): string {
  if (status === 'accepted') return 'badge badge-success'
  if (status === 'sent') return 'badge badge-confirmed'
  return 'badge badge-muted'
}

export function QuotePublic() {
  const { token } = useParams<{ token: string }>()
  const [quote, setQuote] = useState<PublicQuoteResponse | null>(null)
  const [accepted, setAccepted] = useState<QuoteAcceptResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const requestId = useRef<string | null>(null)
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.append(meta)
    const timer = window.setTimeout(() => setReady(true), 900)
    return () => {
      meta.remove()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setError('Link inválido.')
      setLoading(false)
      return
    }
    let active = true
    getPublicQuote<PublicQuoteResponse>(token)
      .then((data) => {
        if (!active) return
        setQuote(data)
        document.title = `Orçamento ${data.reference} — ${data.supplier.name}`
      })
      .catch(() => {
        if (active) setError('Este orçamento não está mais disponível.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  async function acceptQuote() {
    if (!token || !quote) return
    if (!confirm) {
      setActionError('Marque a confirmação para aceitar o orçamento.')
      return
    }
    if (!requestId.current) requestId.current = crypto.randomUUID()
    setBusy('accept')
    setActionError(null)
    try {
      const result = await callPublicFunction<QuoteAcceptResponse>('quote-accept', {
        token,
        confirm: true,
        request_id: requestId.current,
        company_website: '',
        elapsed_ms: Date.now() - mountedAt.current,
      })
      setAccepted(result)
      setQuote((current) =>
        current
          ? {
              ...current,
              status: 'accepted',
              can_accept: false,
              order_reference: result.order_reference,
            }
          : current,
      )
    } catch (acceptError) {
      setActionError(
        acceptError instanceof Error ? acceptError.message : 'Não foi possível aceitar.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function declineQuote() {
    if (!token || !quote) return
    if (!confirm) {
      setActionError('Marque a confirmação para recusar o orçamento.')
      return
    }
    setBusy('decline')
    setActionError(null)
    try {
      await callPublicFunction('quote-decline', { token, confirm: true })
      setQuote((current) =>
        current ? { ...current, status: 'declined', can_accept: false } : current,
      )
    } catch (declineError) {
      setActionError(
        declineError instanceof Error ? declineError.message : 'Não foi possível recusar.',
      )
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <LoadingScreen label="Abrindo orçamento…" />

  if (error || !quote) {
    return (
      <div className="public-shell">
        <header className="public-header">
          <Brand />
        </header>
        <main className="public-main">
          <div className="card centered-card">
            <span className="eyebrow">Orçamento</span>
            <h1>Link indisponível</h1>
            <p>
              Este orçamento expirou, foi cancelado ou o link não é mais válido. Peça uma nova
              proposta ao fornecedor.
            </p>
            <Link to="/" className="button button-secondary">
              Voltar ao início
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const supplierWa = whatsappLink(
    quote.supplier.whatsapp,
    `Olá! Recebi o orçamento ${quote.reference} pelo PedeOutra.`,
  )
  const orderReference = accepted?.order_reference ?? quote.order_reference
  const isAccepted = quote.status === 'accepted' || Boolean(accepted)
  const isOpen = quote.can_accept && quote.status === 'sent'

  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <div className="public-supplier">
          <strong>{quote.supplier.name}</strong>
          <span>Orçamento {quote.reference}</span>
        </div>
        {supplierWa && (
          <a className="button button-ghost" href={supplierWa} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
      </header>

      <main className="public-main">
        <section className="tracking-card">
          <span className="eyebrow">Proposta comercial</span>
          <h1>{quote.reference}</h1>
          <p className="muted">
            Para <strong>{quote.customer.name}</strong>. Válida até{' '}
            {formatDateTime(quote.valid_until)}. Não há pagamento nesta página.
          </p>

          <div className="tracking-current">
            <span className={statusBadgeClass(isAccepted ? 'accepted' : quote.status)}>
              {statusText(isAccepted ? 'accepted' : quote.status)}
            </span>
            <small>Total congelado: {formatBRL(quote.total_cents)}</small>
          </div>

          {quote.notes && <p className="quote-public-notes">{quote.notes}</p>}

          <h2>Itens</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Qtd.</th>
                  <th>Preço</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {quote.items.map((item) => (
                  <tr key={`${item.name}-${item.quantity}`}>
                    <td data-label="Produto">
                      <strong>{item.name}</strong>
                      <small>{item.unit}</small>
                    </td>
                    <td data-label="Qtd.">{item.quantity}</td>
                    <td data-label="Preço">{formatBRL(item.unit_price_cents)}</td>
                    <td data-label="Subtotal">{formatBRL(item.subtotal_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="quote-total">
            <span>Total</span>
            <strong>{formatBRL(quote.total_cents)}</strong>
          </div>

          {isAccepted && orderReference && (
            <FormMessage tone="success">
              Orçamento aceito. Pedido gerado: <strong>{orderReference}</strong>. O fornecedor
              vai confirmar a entrega diretamente com você.
            </FormMessage>
          )}

          {isOpen && (
            <>
              {actionError && <FormMessage>{actionError}</FormMessage>}
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(event) => setConfirm(event.target.checked)}
                />
                <span>
                  Li os itens, quantidades, preços e validade e confirmo o aceite desta
                  proposta comercial.
                </span>
              </label>
              <div className="quote-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!confirm || !ready || busy !== null}
                  onClick={() => void acceptQuote()}
                >
                  {busy === 'accept' ? 'Aceitando…' : 'Aceitar orçamento'}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!confirm || !ready || busy !== null}
                  onClick={() => void declineQuote()}
                >
                  {busy === 'decline' ? 'Recusando…' : 'Recusar'}
                </button>
              </div>
            </>
          )}

          {!isOpen && !isAccepted && (
            <FormMessage tone="info">
              Este orçamento não está mais aberto para aceite. Fale com o fornecedor para
              receber uma nova proposta.
            </FormMessage>
          )}

          <p className="form-note">
            Este documento é uma proposta comercial, não uma nota fiscal ou cobrança. O aceite
            cria um pedido para confirmação do fornecedor.
          </p>
        </section>
      </main>

      <footer className="public-footer">
        <span>Orçamento operado por {quote.supplier.name} com tecnologia PedeOutra.</span>
        <Link to="/privacidade">Privacidade</Link>
        <Link to="/termos">Termos</Link>
      </footer>
    </div>
  )
}
