import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { supabase } from '../lib/supabase'
import { formatBRL, formatDateTime, formatPhone, whatsappLink } from '../lib/format'
import {
  SEGMENT_LABELS,
  SEGMENT_OPTIONS,
  TREND_LABELS,
  buildCustomerReportCsv,
  customerReportFilename,
  type CustomerInsightRow,
  type CustomerInsightsSummary,
} from '../lib/customer-report'
import { EmptyState, FormMessage, PageHeader } from '../components/ui'

interface HistoryOrder {
  order_id: string
  public_reference: string
  status: string
  total_cents: number | null
  item_count: number
  created_at: string
  total_count: number
}

const PAGE_SIZE = 25
const EXPORT_LIMIT = 2000

const STATUS_LABELS: Record<string, string> = {
  new: 'Novo',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  canceled: 'Cancelado',
}

const SEGMENT_TONES: Record<CustomerInsightRow['segment'], string> = {
  no_purchases: 'badge-muted',
  inactive: 'badge-canceled',
  regular: 'badge-active',
  overdue: 'badge-confirmed',
  reactivated: 'badge-completed',
  insufficient: 'badge-muted',
}

function databaseMessage(message: string): string {
  if (message.includes('plan_required')) {
    return 'Este relatório faz parte do plano Profissional.'
  }
  if (message.includes('forbidden') || message.includes('row-level security')) {
    return 'Seu papel não permite abrir este relatório.'
  }
  return 'Não foi possível calcular o relatório agora. Tente novamente.'
}

function contactMessage(row: CustomerInsightRow): string {
  if (row.segment === 'inactive') {
    return `Olá, ${row.display_name}! Sentimos sua falta. Podemos preparar um novo pedido?`
  }
  if (row.segment === 'overdue') {
    return `Olá, ${row.display_name}! Já faz ${row.days_since_last} dias desde o último pedido. Quer repetir?`
  }
  return `Olá, ${row.display_name}! Tudo bem? Podemos ajudar com um novo pedido?`
}

function CustomerInsightList({
  loading,
  rows,
  onHistory,
}: Readonly<{
  loading: boolean
  rows: CustomerInsightRow[]
  onHistory: (row: CustomerInsightRow) => void
}>) {
  if (loading) return <p className="muted">Calculando métricas…</p>
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nenhum cliente neste filtro"
        description="Ajuste a janela, o segmento ou a busca. Clientes sem pedido válido aparecem como “sem compras”, nunca como perdidos."
      />
    )
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Último pedido</th>
            <th>Dias</th>
            <th>Pedidos</th>
            <th>Valor em pedidos</th>
            <th>Recorrência</th>
            <th>Sinal</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const wa = row.contact_phone
              ? whatsappLink(row.contact_phone, contactMessage(row))
              : null
            return (
              <tr key={row.customer_id}>
                <td data-label="Cliente">
                  <strong>{row.display_name}</strong>
                  <small className="cell-sub">
                    {row.contact_phone
                      ? formatPhone(row.contact_phone)
                      : 'Telefone restrito ao seu papel'}
                  </small>
                </td>
                <td data-label="Último pedido">{formatDateTime(row.last_order_at)}</td>
                <td data-label="Dias">{row.days_since_last ?? '—'}</td>
                <td data-label="Pedidos">{row.valid_order_count}</td>
                <td data-label="Valor em pedidos">
                  <strong>{formatBRL(row.orders_value_cents)}</strong>
                  <small className="cell-sub">
                    Conf. {formatBRL(row.confirmed_value_cents)} · Concl.{' '}
                    {formatBRL(row.completed_value_cents)}
                  </small>
                </td>
                <td data-label="Recorrência">
                  {row.median_interval_days === null
                    ? '—'
                    : `~${row.median_interval_days} dias`}
                  <small className="cell-sub">{TREND_LABELS[row.frequency_trend]}</small>
                </td>
                <td data-label="Sinal">
                  <span className={`badge ${SEGMENT_TONES[row.segment]}`}>
                    {SEGMENT_LABELS[row.segment]}
                  </span>
                </td>
                <td data-label="Ações" className="table-actions">
                  <button type="button" className="text-button" onClick={() => onHistory(row)}>
                    Histórico
                  </button>
                  {wa && (
                    <a
                      className="text-button"
                      href={wa}
                      target="_blank"
                      rel="noreferrer"
                      title="Abre o WhatsApp; nada é enviado automaticamente"
                    >
                      WhatsApp
                    </a>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function CustomerReport() {
  const { organization, subscription } = useAuth()
  const [days, setDays] = useState(30)
  const [segment, setSegment] = useState<CustomerInsightRow['segment'] | 'all'>('all')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<CustomerInsightRow[]>([])
  const [summary, setSummary] = useState<CustomerInsightsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null)
  const [history, setHistory] = useState<HistoryOrder[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const organizationId = organization?.id
  const isProfessional = subscription?.plan_code === 'professional'

  useEffect(() => {
    if (!supabase || !organizationId || !isProfessional) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    Promise.all([
      supabase.rpc('api_customer_insights', {
        p_organization_id: organizationId,
        p_inactive_days: days,
        p_segment: segment,
        p_search: appliedSearch || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      }),
      supabase.rpc('api_customer_insights_summary', {
        p_organization_id: organizationId,
        p_inactive_days: days,
      }),
    ]).then(([listResult, summaryResult]) => {
      if (!active) return
      if (listResult.error) {
        setError(databaseMessage(listResult.error.message))
        setRows([])
      } else {
        setRows((listResult.data ?? []) as CustomerInsightRow[])
      }
      if (summaryResult.error) {
        setSummary(null)
      } else {
        setSummary(((summaryResult.data ?? [])[0] ?? null) as CustomerInsightsSummary | null)
      }
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setError('Não foi possível calcular o relatório agora.')
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [organizationId, days, segment, page, appliedSearch, isProfessional])

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    setPage(0)
    setAppliedSearch(search.trim())
  }

  function changeDays(value: number) {
    setDays(value)
    setPage(0)
  }

  function changeSegment(value: CustomerInsightRow['segment'] | 'all') {
    setSegment(value)
    setPage(0)
  }

  async function exportCsv() {
    if (!supabase || !organizationId) return
    setExporting(true)
    setError(null)
    const { data, error: exportError } = await supabase.rpc('api_customer_insights', {
      p_organization_id: organizationId,
      p_inactive_days: days,
      p_segment: segment,
      p_search: appliedSearch || null,
      p_limit: EXPORT_LIMIT,
      p_offset: 0,
    })
    if (exportError) {
      setError(databaseMessage(exportError.message))
    } else {
      const csv = buildCustomerReportCsv((data ?? []) as CustomerInsightRow[], days)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = customerReportFilename(new Date())
      anchor.click()
      URL.revokeObjectURL(url)
    }
    setExporting(false)
  }

  async function openHistory(row: CustomerInsightRow) {
    if (!supabase || !organizationId) return
    setHistoryFor({ id: row.customer_id, name: row.display_name })
    setHistory([])
    setHistoryError(null)
    setHistoryLoading(true)
    const { data, error: historyLoadError } = await supabase.rpc('api_customer_order_history', {
      p_organization_id: organizationId,
      p_customer_id: row.customer_id,
      p_limit: 20,
      p_offset: 0,
    })
    if (historyLoadError) {
      setHistoryError(databaseMessage(historyLoadError.message))
    } else {
      setHistory((data ?? []) as HistoryOrder[])
    }
    setHistoryLoading(false)
  }

  const total = rows[0]?.total_count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (!isProfessional) {
    return (
      <div>
        <PageHeader
          eyebrow="Inteligência comercial"
          title="Relatório de clientes"
          description="Inatividade, recorrência e valor em pedidos com metodologia explícita."
        />
        <section className="card centered-card">
          <span className="eyebrow">Plano Profissional</span>
          <h2>Relatório de clientes</h2>
          <p>
            O relatório mostra quem parou de comprar, quem está fora da cadência e quanto
            já foi movimentado em pedidos confirmados e concluídos. Nenhum valor é tratado
            como receita recebida.
          </p>
          <Link to="/app/assinatura" className="button button-primary">
            Conhecer o Profissional
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inteligência comercial"
        title="Relatório de clientes"
        description="Inatividade configurável, recorrência e valor em pedidos. Calculado no servidor e isolado por organização."
        action={
          <div className="inline-actions">
            <Link to="/app/radar" className="button button-secondary">
              Abrir Radar
            </Link>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void exportCsv()}
              disabled={exporting || loading}
            >
              {exporting ? 'Exportando…' : 'Exportar CSV'}
            </button>
          </div>
        }
      />

      {error && <FormMessage>{error}</FormMessage>}

      {summary && (
        <div className="stat-grid">
          <article className="stat-card">
            <span>Clientes na base</span>
            <strong>{summary.total_customers}</strong>
            <small className="cell-sub">Inclui quem ainda não comprou</small>
          </article>
          <article className="stat-card">
            <span>Ativos na janela</span>
            <strong>{summary.active_customers}</strong>
            <small className="cell-sub">Pedido válido nos últimos {days} dias</small>
          </article>
          <article className="stat-card stat-card-accent">
            <span>Inativos</span>
            <strong>{summary.inactive_customers}</strong>
            <small className="cell-sub">Sem pedido válido na janela</small>
          </article>
          <article className="stat-card">
            <span>Reativados</span>
            <strong>{summary.reactivated_customers}</strong>
            <small className="cell-sub">Voltaram após um intervalo</small>
          </article>
        </div>
      )}

      {summary && (
        <p className="muted report-note">
          {summary.no_purchase_customers} sem compras válidas ·{' '}
          {summary.insufficient_customers} com histórico curto ·{' '}
          {summary.valid_order_count} pedidos confirmados/concluídos ·{' '}
          {formatBRL(summary.orders_value_cents)} em pedidos (não é receita recebida)
        </p>
      )}

      <section className="card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Clientes</span>
            <h2>Quem precisa de atenção</h2>
          </div>
          <div className="report-filters">
            <label className="field-inline">
              <span>Inatividade</span>
              <select
                value={days}
                onChange={(event) => changeDays(Number(event.target.value))}
                aria-label="Janela de inatividade"
              >
                <option value={30}>30 dias</option>
                <option value={60}>60 dias</option>
                <option value={90}>90 dias</option>
              </select>
            </label>
            <label className="field-inline">
              <span>Segmento</span>
              <select
                value={segment}
                onChange={(event) =>
                  changeSegment(event.target.value as CustomerInsightRow['segment'] | 'all')
                }
                aria-label="Segmento de clientes"
              >
                {SEGMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <form className="inline-form" onSubmit={submitSearch}>
              <input
                type="search"
                className="search-input"
                placeholder="Buscar cliente ou telefone"
                aria-label="Buscar cliente no relatório"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="submit" className="button button-secondary">
                Buscar
              </button>
            </form>
          </div>
        </div>

        <CustomerInsightList
          loading={loading}
          rows={rows}
          onHistory={(row) => void openHistory(row)}
        />

        {pages > 1 && (
          <div className="pagination">
            <button
              type="button"
              className="button button-secondary"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Anterior
            </button>
            <span className="muted">
              Página {page + 1} de {pages}
            </span>
            <button
              type="button"
              className="button button-secondary"
              disabled={page + 1 >= pages}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </button>
          </div>
        )}

        <details className="report-method">
          <summary>Como calculamos</summary>
          <ul>
            <li>Só pedidos confirmados e concluídos entram nas métricas; cancelados ficam fora.</li>
            <li>
              “Inativo” significa nenhum pedido válido na janela escolhida. Cliente sem nenhum
              pedido válido aparece como “sem compras válidas”.
            </li>
            <li>
              “Atrasado” compara os dias desde a última compra com o intervalo mediano do próprio
              cliente, com a tolerância da organização.
            </li>
            <li>
              “Reativado” é quem tinha pedido anterior fora da janela e voltou a comprar dentro
              dela.
            </li>
            <li>
              Valores são de pedidos, não receita liquidada. Datas usam America/Sao_Paulo para
              exibição e a base armazena UTC.
            </li>
          </ul>
        </details>
      </section>

      {historyFor && (
        <section className="card" aria-live="polite">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Histórico</span>
              <h2>{historyFor.name}</h2>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setHistoryFor(null)
                setHistory([])
              }}
            >
              Fechar
            </button>
          </div>
          {historyError && <FormMessage>{historyError}</FormMessage>}
          {historyLoading && <p className="muted">Carregando pedidos…</p>}
          {!historyLoading && history.length === 0 && (
            <p className="muted">Nenhum pedido registrado para este cliente.</p>
          )}
          {!historyLoading && history.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Referência</th>
                    <th>Data</th>
                    <th>Status</th>
                    <th>Itens</th>
                    <th>Total</th>
                    <th aria-label="Abrir" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((order) => (
                    <tr key={order.order_id}>
                      <td data-label="Referência">
                        <strong>{order.public_reference}</strong>
                      </td>
                      <td data-label="Data">{formatDateTime(order.created_at)}</td>
                      <td data-label="Status">{STATUS_LABELS[order.status] ?? order.status}</td>
                      <td data-label="Itens">{order.item_count}</td>
                      <td data-label="Total">{formatBRL(order.total_cents)}</td>
                      <td data-label="Abrir" className="table-actions">
                        <Link className="text-button" to={`/app/pedidos/${order.order_id}`}>
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
