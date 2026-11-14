import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { FormMessage, LoadingScreen } from '../components/ui'
import { getOrderTracking } from '../lib/edge'
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
            <span className={`badge badge-${data.status === 'canceled' ? 'muted' : data.status === 'completed' ? 'success' : 'confirmed'}`}>
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

          <p className="form-note">
            Este é um acompanhamento informativo. O fornecedor confirma o pedido diretamente
            com você; não há pagamento nesta página.
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
