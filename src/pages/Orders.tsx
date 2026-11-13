import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { formatBRL, formatDateTime, statusLabel, statusTone } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { OrderStatus, OrderWithCustomer } from '../lib/types'
import { EmptyState, FormMessage, PageHeader } from '../components/ui'

const TABS: Array<{ key: 'all' | OrderStatus; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'new', label: 'Novos' },
  { key: 'confirmed', label: 'Confirmados' },
  { key: 'completed', label: 'Concluídos' },
  { key: 'canceled', label: 'Cancelados' },
]

export function Orders() {
  const { organization } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const initial = searchParams.get('status') as 'all' | OrderStatus | null
  const [tab, setTab] = useState<'all' | OrderStatus>(
    initial && ['all', 'new', 'confirmed', 'completed', 'canceled'].includes(initial)
      ? initial
      : 'all',
  )
  const [orders, setOrders] = useState<OrderWithCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const organizationId = organization?.id

  async function loadOrders() {
    if (!supabase || !organizationId) return
    setLoading(true)
    setError(null)
    const { data, error: loadError } = await supabase
      .from('orders')
      .select('*, customers(display_name)')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(200)

    if (loadError) {
      setError('Não foi possível carregar os pedidos.')
    } else {
      setOrders((data ?? []) as unknown as OrderWithCustomer[])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId])

  function selectTab(key: 'all' | OrderStatus) {
    setTab(key)
    if (key === 'all') {
      searchParams.delete('status')
    } else {
      searchParams.set('status', key)
    }
    setSearchParams(searchParams, { replace: true })
  }

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: orders.length }
    for (const order of orders) {
      result[order.status] = (result[order.status] ?? 0) + 1
    }
    return result
  }, [orders])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return orders.filter((order) => {
      if (tab !== 'all' && order.status !== tab) return false
      if (!term) return true
      return (
        order.public_reference.toLowerCase().includes(term) ||
        (order.customers?.display_name ?? '').toLowerCase().includes(term) ||
        (order.buyer_name ?? '').toLowerCase().includes(term)
      )
    })
  }, [orders, search, tab])

  return (
    <div>
      <PageHeader
        eyebrow="Operação"
        title="Pedidos"
        description="Confirme, conclua ou cancele. Cada mudança de status fica registrada com horário e autor."
        action={
          <button type="button" className="button button-secondary" onClick={() => void loadOrders()}>
            Atualizar
          </button>
        }
      />

      {error && <FormMessage>{error}</FormMessage>}

      <section className="card">
        <div className="order-toolbar">
          <div className="tabs" role="tablist" aria-label="Filtrar por status">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={tab === item.key ? 'tab active' : 'tab'}
                onClick={() => selectTab(item.key)}
              >
                {item.label}
                <span>{counts[item.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            className="search-input"
            placeholder="Buscar referência ou cliente"
            aria-label="Buscar pedido"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {loading ? (
          <p className="muted">Carregando pedidos…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={orders.length === 0 ? 'Nenhum pedido ainda' : 'Nenhum pedido neste filtro'}
            description={
              orders.length === 0
                ? 'Compartilhe o link do catálogo com um cliente comercial. O pedido aparece aqui para confirmação.'
                : 'Ajuste o filtro ou o termo de busca.'
            }
            action={
              orders.length === 0 ? (
                <Link to={`/c/${organization?.slug ?? ''}`} className="button button-primary">
                  Abrir catálogo
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table order-table">
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Cliente</th>
                  <th>Recebido</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th aria-label="Abrir" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.id}>
                    <td data-label="Referência">
                      <strong>{order.public_reference}</strong>
                      <small className="cell-sub">
                        {order.source === 'reorder' ? 'Recompra' : 'Catálogo'}
                      </small>
                    </td>
                    <td data-label="Cliente">
                      {order.customers?.display_name || order.buyer_name || 'Comprador'}
                    </td>
                    <td data-label="Recebido">{formatDateTime(order.created_at)}</td>
                    <td data-label="Total">{formatBRL(order.total_cents)}</td>
                    <td data-label="Status">
                      <span className={`badge badge-${statusTone(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                    </td>
                    <td data-label="Abrir" className="table-actions">
                      <Link className="text-link" to={`/app/pedidos/${order.id}`}>
                        Abrir →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
