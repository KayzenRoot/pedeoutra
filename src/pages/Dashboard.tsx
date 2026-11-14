import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CatalogQrPanel } from '../components/CatalogQrPanel'
import { useAuth } from '../context/auth-context'
import { ACCESS_TEXT, organizationAccess } from '../lib/access'
import { formatBRL, formatDateTime, statusLabel, statusTone } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { OrderWithCustomer } from '../lib/types'
import { EmptyState, PageHeader } from '../components/ui'

interface DashboardData {
  productsActive: number
  customers: number
  newOrders: number
  totalOrders: number
  reorderLinks: number
  recentOrders: OrderWithCustomer[]
}

const EMPTY: DashboardData = {
  productsActive: 0,
  customers: 0,
  newOrders: 0,
  totalOrders: 0,
  reorderLinks: 0,
  recentOrders: [],
}

export function Dashboard() {
  const { organization, subscription } = useAuth()
  const [data, setData] = useState<DashboardData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const organizationId = organization?.id

  useEffect(() => {
    if (!supabase || !organizationId) return
    let active = true

    async function load() {
      setLoading(true)
      setError(null)
      const client = supabase
      const orgId = organizationId
      if (!client || !orgId) return

      const [products, customers, newOrders, totalOrders, links, recent] = await Promise.all([
        client
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('active', true),
        client
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId),
        client
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'new'),
        client
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId),
        client
          .from('reorder_links_safe')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId),
        client
          .from('orders')
          .select('*, customers(display_name)')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      if (!active) return

      const firstError =
        products.error ?? customers.error ?? newOrders.error ?? totalOrders.error ?? links.error ?? recent.error
      if (firstError) {
        setError('Não foi possível carregar o painel. Atualize a página.')
        setLoading(false)
        return
      }

      setData({
        productsActive: products.count ?? 0,
        customers: customers.count ?? 0,
        newOrders: newOrders.count ?? 0,
        totalOrders: totalOrders.count ?? 0,
        reorderLinks: links.count ?? 0,
        recentOrders: (recent.data ?? []) as unknown as OrderWithCustomer[],
      })
      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [organizationId])

  const access = organizationAccess(organization, subscription)
  const trialLabel =
    access.label === 'trial' && access.trialDaysLeft !== null
      ? access.trialDaysLeft > 0
        ? `${access.trialDaysLeft} ${access.trialDaysLeft === 1 ? 'dia restante' : 'dias restantes'}`
        : 'último dia'
      : ACCESS_TEXT[access.label]

  const checklist = [
    {
      done: data.productsActive > 0,
      title: 'Cadastre seu primeiro produto',
      description: 'Nome, unidade e preço opcional. Você pode pausar depois.',
      to: '/app/produtos',
      action: 'Adicionar produto',
    },
    {
      done: data.productsActive >= 5,
      title: 'Chegue a 5 produtos ativos',
      description: 'Um catálogo com variedade já permite um pedido completo.',
      to: '/app/produtos',
      action: 'Ver produtos',
    },
    {
      done: data.totalOrders > 0,
      title: 'Receba o primeiro pedido',
      description: 'Compartilhe o link do catálogo com um cliente comercial.',
      to: `/c/${organization?.slug ?? ''}`,
      action: 'Abrir catálogo',
    },
    {
      done: data.reorderLinks > 0,
      title: 'Crie um link de recompra',
      description: 'Depois de um pedido, o cliente pode repetir em poucos toques.',
      to: '/app/pedidos',
      action: 'Ver pedidos',
    },
  ]

  return (
    <div className="dashboard">
      <PageHeader
        eyebrow="Visão geral"
        title={`Olá, ${organization?.name ?? 'fornecedor'}`}
        description="O essencial para acompanhar catálogo, pedidos e recompra."
        action={
          <Link to="/app/produtos" className="button button-primary">
            Adicionar produto
          </Link>
        }
      />

      {error && <div className="form-message form-message-error">{error}</div>}

      <div className="stat-grid">
        <article className="stat-card">
          <span>Produtos ativos</span>
          <strong>{loading ? '—' : data.productsActive}</strong>
          <Link to="/app/produtos">Gerenciar →</Link>
        </article>
        <article className="stat-card">
          <span>Clientes</span>
          <strong>{loading ? '—' : data.customers}</strong>
          <Link to="/app/clientes">Gerenciar →</Link>
        </article>
        <article className="stat-card stat-card-accent">
          <span>Pedidos novos</span>
          <strong>{loading ? '—' : data.newOrders}</strong>
          <Link to="/app/pedidos?status=new">Ver pedidos →</Link>
        </article>
        <article className="stat-card">
          <span>Links de recompra</span>
          <strong>{loading ? '—' : data.reorderLinks}</strong>
          <Link to="/app/pedidos">Criar link →</Link>
        </article>
      </div>

      <div className="dashboard-grid">
        <section className="card access-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Seu acesso</span>
              <h2>{trialLabel}</h2>
            </div>
            <span className={`access-pill access-${access.label}`}>
              {access.label === 'trial' ? 'Teste' : ACCESS_TEXT[access.label]}
            </span>
          </div>
          {access.label === 'trial' && (
            <p>
              Você tem todos os recursos durante o teste. Ao final, assine para manter o
              catálogo e os pedidos ativos.
            </p>
          )}
          {access.label === 'active' && (
            <p>Assinatura ativa. O acesso é renovado conforme o pagamento confirmado.</p>
          )}
          {!access.canWrite && (
            <p className="text-warning">
              Escritas estão pausadas. Leitura e histórico permanecem disponíveis.
            </p>
          )}
          <div className="access-meta">
            <span>Teste termina em {formatDateTime(organization?.trial_ends_at)}</span>
            {subscription?.current_period_end && (
              <span>Período atual até {formatDateTime(subscription.current_period_end)}</span>
            )}
          </div>
          <Link to="/app/assinatura" className="button button-secondary">
            Ver assinatura
          </Link>
        </section>

        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Próximos passos</span>
              <h2>Ativação do catálogo</h2>
            </div>
            <span className="muted">
              {checklist.filter((item) => item.done).length}/{checklist.length}
            </span>
          </div>
          <ul className="checklist">
            {checklist.map((item) => (
              <li key={item.title} className={item.done ? 'done' : ''}>
                <span className="check-dot" aria-hidden="true">
                  {item.done ? '✓' : ''}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
                {!item.done && (
                  <Link to={item.to} className="text-link">
                    {item.action}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Últimos pedidos</span>
            <h2>Movimento recente</h2>
          </div>
          <Link to="/app/pedidos" className="text-link">
            Ver todos →
          </Link>
        </div>

        {loading ? (
          <p className="muted">Carregando pedidos…</p>
        ) : data.recentOrders.length === 0 ? (
          <EmptyState
            title="Nenhum pedido ainda"
            description="Compartilhe o link do catálogo com um cliente. Quando ele enviar, o pedido aparece aqui."
            action={
              <Link to={`/c/${organization?.slug ?? ''}`} className="button button-primary">
                Abrir meu catálogo
              </Link>
            }
          />
        ) : (
          <div className="order-list">
            {data.recentOrders.map((order) => (
              <Link to={`/app/pedidos/${order.id}`} className="order-row" key={order.id}>
                <div>
                  <strong>
                    {order.customers?.display_name || order.buyer_name || 'Comprador'}
                  </strong>
                  <small>
                    {order.public_reference} · {formatDateTime(order.created_at)}
                  </small>
                </div>
                <span className="order-total">{formatBRL(order.total_cents)}</span>
                <span className={`badge badge-${statusTone(order.status)}`}>
                  {statusLabel(order.status)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {organization && (
        <CatalogQrPanel
          slug={organization.slug}
          organizationName={organization.name}
        />
      )}
    </div>
  )
}
