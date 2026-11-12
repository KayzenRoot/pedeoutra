import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { callAuthedFunction } from '../lib/edge'
import {
  buildOrderMessage,
  catalogUrl,
  formatBRL,
  formatDateTime,
  formatPhone,
  nextStatuses,
  statusLabel,
  statusTone,
  whatsappLink,
} from '../lib/format'
import { supabase } from '../lib/supabase'
import type {
  CreateReorderLinkResponse,
  Order,
  OrderItem,
  OrderStatus,
  OrderStatusEvent,
  ReorderLink,
} from '../lib/types'
import { CopyButton, FormMessage, LoadingScreen } from '../components/ui'

interface OrderDetailRow extends Order {
  customers: { display_name: string; contact_phone: string } | null
}

function linkState(link: ReorderLink): { label: string; tone: string } {
  if (link.revoked_at) return { label: 'Revogado', tone: 'badge-muted' }
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
    return { label: 'Expirado', tone: 'badge-muted' }
  }
  return { label: 'Ativo', tone: 'badge-active' }
}

export function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>()
  const { organization, user } = useAuth()
  const [order, setOrder] = useState<OrderDetailRow | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [events, setEvents] = useState<OrderStatusEvent[]>([])
  const [links, setLinks] = useState<ReorderLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createdLink, setCreatedLink] = useState<string | null>(null)

  const organizationId = organization?.id

  async function loadOrder() {
    if (!supabase || !organizationId || !orderId) return
    setLoading(true)
    setError(null)

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('*, customers(display_name, contact_phone)')
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (orderError) {
      setError('Não foi possível carregar o pedido.')
      setLoading(false)
      return
    }
    if (!orderData) {
      setOrder(null)
      setLoading(false)
      return
    }

    const detail = orderData as unknown as OrderDetailRow
    const [itemsResult, eventsResult, linksResult] = await Promise.all([
      supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('order_status_events')
        .select('*')
        .eq('order_id', orderId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true }),
      detail.customer_id
        ? supabase
            .from('reorder_links_safe')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('customer_id', detail.customer_id)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (itemsResult.error || eventsResult.error || linksResult.error) {
      setError('Não foi possível carregar os detalhes do pedido.')
    } else {
      setOrder(detail)
      setItems(itemsResult.data ?? [])
      setEvents(eventsResult.data ?? [])
      setLinks((linksResult.data ?? []) as ReorderLink[])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadOrder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, organizationId])

  async function changeStatus(next: OrderStatus) {
    if (!supabase || !organizationId || !order) return
    if (next === 'canceled' && !window.confirm('Cancelar este pedido? A ação fica registrada.')) {
      return
    }

    setBusy(true)
    setActionError(null)
    setActionSuccess(null)
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: next })
      .eq('id', order.id)
      .eq('organization_id', organizationId)

    if (updateError) {
      setActionError(
        updateError.message.includes('invalid_status_transition')
          ? 'Essa mudança de status não é permitida.'
          : 'Não foi possível atualizar o pedido.',
      )
    } else {
      setActionSuccess(`Pedido marcado como ${statusLabel(next).toLowerCase()}.`)
      await loadOrder()
    }
    setBusy(false)
  }

  async function linkCustomer() {
    if (!order) return
    setBusy(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      const result = await callAuthedFunction<{
        customer_id: string
        display_name?: string
        created: boolean
      }>('link-order-customer', { order_id: order.id })
      setActionSuccess(
        result.created
          ? 'Cliente criado e vinculado ao pedido.'
          : 'Pedido vinculado ao cliente existente.',
      )
      await loadOrder()
    } catch (linkError) {
      setActionError(
        linkError instanceof Error ? linkError.message : 'Não foi possível vincular o cliente.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function createReorderLink() {
    if (!order?.customer_id) return
    setBusy(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      const result = await callAuthedFunction<CreateReorderLinkResponse>('reorder-create', {
        customer_id: order.customer_id,
      })
      setCreatedLink(result.url)
      setActionSuccess('Link de recompra criado. Copie agora; ele não será exibido novamente.')
      await loadOrder()
    } catch (linkError) {
      setActionError(
        linkError instanceof Error ? linkError.message : 'Não foi possível criar o link.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function revokeLink(linkId: string) {
    if (!window.confirm('Revogar este link? O cliente não conseguirá mais usá-lo.')) return
    setBusy(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await callAuthedFunction('reorder-revoke', { link_id: linkId })
      setActionSuccess('Link revogado.')
      await loadOrder()
    } catch (revokeError) {
      setActionError(
        revokeError instanceof Error ? revokeError.message : 'Não foi possível revogar o link.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingScreen label="Carregando pedido…" />
  if (error) return <FormMessage>{error}</FormMessage>
  if (!order) {
    return (
      <div className="card">
        <h1>Pedido não encontrado</h1>
        <p>Ele pode ter sido removido ou pertence a outra organização.</p>
        <Link to="/app/pedidos" className="button button-secondary">
          Voltar aos pedidos
        </Link>
      </div>
    )
  }
  if (!organization) return null

  const phone = order.customers?.contact_phone ?? order.buyer_phone
  const message = buildOrderMessage({
    organizationName: organization.name,
    reference: order.public_reference,
    items,
    totalCents: order.total_cents,
  })
  const waLink = whatsappLink(phone, message)
  const transitions = nextStatuses(order.status)

  return (
    <div className="order-detail">
      <Link to="/app/pedidos" className="back-link">
        ← Voltar aos pedidos
      </Link>

      <header className="order-detail-header">
        <div>
          <span className="eyebrow">Pedido</span>
          <h1>{order.public_reference}</h1>
          <p>
            Recebido em {formatDateTime(order.created_at)} ·{' '}
            {order.source === 'reorder' ? 'Recompra' : 'Catálogo público'}
          </p>
        </div>
        <div className="order-detail-total">
          <span className={`badge badge-${statusTone(order.status)}`}>
            {statusLabel(order.status)}
          </span>
          <strong>{formatBRL(order.total_cents)}</strong>
        </div>
      </header>

      {actionError && <FormMessage>{actionError}</FormMessage>}
      {actionSuccess && <FormMessage tone="success">{actionSuccess}</FormMessage>}

      {createdLink && (
        <div className="link-created">
          <div>
            <span className="eyebrow">Link de recompra</span>
            <input readOnly value={createdLink} onFocus={(event) => event.target.select()} />
          </div>
          <div className="link-created-actions">
            <CopyButton value={createdLink} label="Copiar link" />
            <a
              className="button button-secondary"
              href={createdLink}
              target="_blank"
              rel="noreferrer"
            >
              Abrir
            </a>
          </div>
          <p>Por segurança, o token só aparece nesta tela. Se perder, gere outro link.</p>
        </div>
      )}

      <div className="order-detail-grid">
        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Itens</span>
              <h2>O que foi pedido</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qtd.</th>
                  <th>Preço</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Item">
                      <strong>{item.name_snapshot}</strong>
                      <small className="cell-sub">{item.unit_snapshot}</small>
                    </td>
                    <td data-label="Qtd.">{item.quantity}</td>
                    <td data-label="Preço">{formatBRL(item.unit_price_cents)}</td>
                    <td data-label="Subtotal">{formatBRL(item.subtotal_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="order-total-line">
            <span>Total do pedido</span>
            <strong>{formatBRL(order.total_cents)}</strong>
          </div>
          {order.note && (
            <div className="order-note">
              <span>Observação do comprador</span>
              <p>{order.note}</p>
            </div>
          )}
        </section>

        <aside className="order-side">
          <section className="card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Comprador</span>
                <h2>{order.customers?.display_name || order.buyer_name || 'Comprador'}</h2>
              </div>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Telefone</dt>
                <dd>{formatPhone(phone)}</dd>
              </div>
              <div>
                <dt>Cliente vinculado</dt>
                <dd>{order.customer_id ? 'Sim' : 'Ainda não'}</dd>
              </div>
            </dl>

            {!order.customer_id && order.buyer_name && order.buyer_phone && (
              <button
                type="button"
                className="button button-secondary button-block"
                onClick={() => void linkCustomer()}
                disabled={busy}
              >
                Vincular como cliente
              </button>
            )}

            {waLink ? (
              <a
                className="button button-whatsapp button-block"
                href={waLink}
                target="_blank"
                rel="noreferrer"
              >
                Enviar confirmação no WhatsApp
              </a>
            ) : (
              <p className="form-note">Sem telefone para abrir o WhatsApp.</p>
            )}
            <p className="form-note">
              A mensagem é apenas um rascunho. O envio depende do seu clique no WhatsApp.
            </p>
          </section>

          <section className="card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Status</span>
                <h2>Próxima ação</h2>
              </div>
            </div>
            {transitions.length === 0 ? (
              <p className="muted">Este pedido está em estado final.</p>
            ) : (
              <div className="status-actions">
                {transitions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={
                      status === 'canceled'
                        ? 'button button-danger button-block'
                        : 'button button-primary button-block'
                    }
                    disabled={busy}
                    onClick={() => void changeStatus(status)}
                  >
                    {status === 'confirmed' && 'Confirmar pedido'}
                    {status === 'completed' && 'Marcar como concluído'}
                    {status === 'canceled' && 'Cancelar pedido'}
                  </button>
                ))}
              </div>
            )}

            <ol className="timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div>
                    <strong>{statusLabel(event.to_status)}</strong>
                    <small>
                      {formatDateTime(event.created_at)} ·{' '}
                      {event.actor_user_id === user?.id
                        ? 'Você'
                        : event.actor_user_id
                          ? 'Usuário do painel'
                          : 'Sistema'}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Recompra</span>
                <h2>Repetir pedido</h2>
              </div>
            </div>

            {!order.customer_id ? (
              <p className="muted">
                Vincule o pedido a um cliente para gerar um link de recompra seguro.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="button button-primary button-block"
                  disabled={busy}
                  onClick={() => void createReorderLink()}
                >
                  Gerar link de recompra
                </button>
                <p className="form-note">
                  O link recria os itens e quantidades deste pedido sem exibir nome, telefone ou
                  histórico. Preços são recalculados no servidor.
                </p>
              </>
            )}

            {links.length > 0 && (
              <ul className="link-list">
                {links.map((link) => {
                  const state = linkState(link)
                  return (
                    <li key={link.id ?? link.created_at}>
                      <div>
                        <strong>{formatDateTime(link.created_at)}</strong>
                        <small>
                          Expira em {formatDateTime(link.expires_at)}
                          {link.last_used_at
                            ? ` · usado em ${formatDateTime(link.last_used_at)}`
                            : ''}
                        </small>
                      </div>
                      <span className={`badge ${state.tone}`}>{state.label}</span>
                      {!link.revoked_at && state.label === 'Ativo' && link.id && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void revokeLink(link.id as string)}
                          disabled={busy}
                        >
                          Revogar
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <a
              className="text-link"
              href={catalogUrl(organization.slug)}
              target="_blank"
              rel="noreferrer"
            >
              Ver catálogo público →
            </a>
          </section>
        </aside>
      </div>
    </div>
  )
}
