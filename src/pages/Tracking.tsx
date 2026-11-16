import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { FormMessage, LoadingScreen } from '../components/ui'
import { getOrderTracking } from '../lib/edge'
import { downloadOrderReceipt } from '../lib/order-pdf'
import { formatDateTime } from '../lib/format'
import type { OrderTrackingResponse } from '../lib/types'

const STATUS_TEXT: Record<string, string> = {
  new: 'Pedido recebido',
  confirmed: 'Confirmado pelo fornecedor',
  completed: 'Concluído',
  canceled: 'Cancelado',
}

function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status
}

function statusBadgeClass(status: string): string {
  if (status === 'canceled') return 'badge badge-muted'
  if (status === 'completed') return 'badge badge-success'
  return 'badge badge-confirmed'
}

export function Tracking() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<OrderTrackingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.append(meta)
    return () => meta.remove()
  }, [])

  useEffect(() => {
    if (!token) {
      setError(true)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    getOrderTracking<OrderTrackingResponse>(token)
      .then((response) => {
        if (active) setData(response)
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  if (loading) return <LoadingScreen label="Consultando pedido…" />

  if (error || !data) {
    return (
      <div className="public-shell">
        <header className="public-header">
          <Brand />
        </header>
        <main className="public-main">
          <div className="card centered-card">
            <span className="eyebrow">Acompanhamento</span>
            <h1>Link inválido ou expirado</h1>
            <p>
              Este link não está mais disponível. Peça um novo link ao fornecedor para
              consultar o pedido.
            </p>
            <Link to="/" className="button button-secondary">
              Voltar ao início
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <span className="public-supplier">{data.supplier.name}</span>
      </header>
      <main className="public-main">
        <section className="tracking-card">
          <span className="eyebrow">Acompanhamento do pedido</span>
          <h1>{data.reference}</h1>
          <p className="muted">
            Pedido feito em {formatDateTime(data.created_at)}. Esta página mostra apenas o
            status; não exibe telefone, observações ou dados de outros pedidos.
          </p>

          <div className="tracking-current">
            <span className={statusBadgeClass(data.status)}>
              {statusText(data.status)}
            </span>
            <small>Link válido até {formatDateTime(data.expires_at)}</small>
          </div>

          <h2>Histórico</h2>
          <ol className="tracking-timeline">
            {data.timeline.map((event) => (
              <li key={`${event.status}-${event.at}`}>
                <strong>{statusText(event.status)}</strong>
                <span>{formatDateTime(event.at)}</span>
              </li>
            ))}
          </ol>

          {data.items.length > 0 && (
            <>
              <h2>Itens</h2>
              <ul className="tracking-items">
                {data.items.map((item) => (
                  <li key={`${item.name}-${item.quantity}`}>
                    <span>{item.name}</span>
                    <strong>{item.quantity}×</strong>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button
            type="button"
            className="button button-secondary button-block"
            onClick={() =>
              downloadOrderReceipt({
                organizationName: data.supplier.name,
                reference: data.reference,
                createdAt: data.created_at,
                status: data.status,
                items: data.items.map((item) => ({
                  name: item.name,
                  quantity: item.quantity,
                })),
                totalCents: data.total_cents,
                includeBuyer: false,
                includePrices: false,
                documentTitle: 'Comprovante de acompanhamento',
              })
            }
          >
            Baixar comprovante em PDF
          </button>
          <p className="form-note">
            O PDF reduzido não inclui telefone, observações, preços por item nem links. Este é
            um acompanhamento informativo; o fornecedor confirma o pedido diretamente com você.
          </p>
          <Link className="text-link" to={`/c/${data.supplier.slug}`}>
            Ver catálogo do fornecedor →
          </Link>
        </section>
        <FormMessage tone="info">
          O link é pessoal e opaco. Não o publique em redes sociais; se ele expirar, peça um
          novo ao fornecedor.
        </FormMessage>
      </main>
    </div>
  )
}
