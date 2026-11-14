import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { callAuthedFunction } from '../lib/edge'
import { supabase } from '../lib/supabase'
import { formatDateTime, formatPhone, whatsappLink } from '../lib/format'
import { FormMessage, PageHeader } from '../components/ui'

interface RadarRow {
  customer_id: string
  display_name: string
  contact_phone: string
  valid_order_count: number
  last_order_at: string
  median_interval_days: number | null
  next_expected_at: string | null
  days_since_last: number
  overdue: boolean
  insufficient: boolean
  snoozed_until: string | null
  total_count: number
}

interface ReminderRow {
  id: string
  customer_id: string
  status: string
  created_at: string
  opened_at: string | null
}

const PAGE_SIZE = 25

function signal(row: RadarRow): { label: string; tone: string } {
  if (row.snoozed_until && new Date(row.snoozed_until).getTime() > Date.now()) {
    return { label: 'Silenciado', tone: 'badge-muted' }
  }
  if (row.insufficient) return { label: 'Dados insuficientes', tone: 'badge-muted' }
  if (row.overdue) return { label: 'Atrasado', tone: 'badge-confirmed' }
  return { label: 'Em dia', tone: 'badge-active' }
}

export function Radar() {
  const { organization, subscription, membershipRole } = useAuth()
  const [rows, setRows] = useState<RadarRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [reminders, setReminders] = useState<ReminderRow[]>([])
  const [success, setSuccess] = useState<string | null>(null)

  const organizationId = organization?.id
  const isProfessional = subscription?.plan_code === 'professional'
  const canWrite = ['owner', 'manager', 'operator'].includes(membershipRole ?? 'owner')

  async function loadRadar() {
    if (!supabase || !organizationId) return
    setLoading(true)
    setError(null)
    const [radarResult, remindersResult] = await Promise.all([
      supabase.rpc('api_reorder_radar', {
        p_organization_id: organizationId,
        p_search: search.trim() || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      }),
      supabase
        .from('reorder_reminders')
        .select('id, customer_id, status, created_at, opened_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    if (radarResult.error) {
      setError('Não foi possível calcular o radar agora.')
    } else {
      setRows((radarResult.data ?? []) as RadarRow[])
    }
    if (!remindersResult.error) setReminders((remindersResult.data ?? []) as ReminderRow[])
    setLoading(false)
  }

  useEffect(() => {
    if (!isProfessional) {
      setLoading(false)
      return
    }
    void loadRadar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, page, isProfessional])

  function radarState() {
    if (loading) return <p className="muted">Calculando cadência…</p>
    if (rows.length === 0) {
      return (
        <p className="muted">
          Nenhum cliente com pedidos confirmados/concluídos suficiente para o radar.
        </p>
      )
    }
    return null
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    setPage(0)
    void loadRadar()
  }

  async function snooze(row: RadarRow, days: number) {
    if (!supabase || !organizationId) return
    setBusy(row.customer_id)
    setError(null)
    const until = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null
    const { error: updateError } = await supabase
      .from('customers')
      .update({ reorder_snoozed_until: until })
      .eq('id', row.customer_id)
      .eq('organization_id', organizationId)
    if (updateError) setError('Não foi possível atualizar a sugestão.')
    else await loadRadar()
    setBusy(null)
  }

  async function createReminder(row: RadarRow) {
    setBusy(row.customer_id)
    setError(null)
    setSuccess(null)
    try {
      const cycleKey = `${row.customer_id}:${(row.next_expected_at ?? row.last_order_at).slice(0, 10)}`
      const message = `Olá, ${row.display_name}! Tudo bem? Já faz ${row.days_since_last} dias desde o último pedido. Quer repetir?`
      const reminder = await callAuthedFunction<{ reminder_id: string }>(
        'reorder-reminder-create',
        { customer_id: row.customer_id, cycle_key: cycleKey, message },
      )
      const wa = whatsappLink(row.contact_phone, message)
      if (wa) window.open(wa, '_blank', 'noopener,noreferrer')
      await callAuthedFunction('reorder-reminder-open', { reminder_id: reminder.reminder_id })
      setSuccess(`Lembrete manual preparado para ${row.display_name}. Nenhum envio automático foi feito.`)
      await loadRadar()
    } catch (reminderError) {
      setError(
        reminderError instanceof Error
          ? reminderError.message
          : 'Não foi possível preparar o lembrete.',
      )
    } finally {
      setBusy(null)
    }
  }

  const total = rows[0]?.total_count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (!isProfessional) {
    return (
      <div>
        <PageHeader
          eyebrow="Retenção"
          title="Radar de recompra"
          description="Estimativa de cadência e lembretes manuais para clientes recorrentes."
        />
        <section className="card centered-card">
          <span className="eyebrow">Plano Profissional</span>
          <h2>Radar de recompra</h2>
          <p>
            O radar calcula a cadência real de cada cliente e sugere quando falar com ele. O
            envio automático permanece desligado; o fornecedor usa o WhatsApp manual.
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
        eyebrow="Retenção"
        title="Radar de recompra"
        description="Cadência calculada a partir de pedidos confirmados e concluídos. É uma estimativa operacional, não uma garantia de compra."
        action={<span className="muted">{total} cliente(s) com histórico</span>}
      />

      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      <section className="card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Clientes</span>
            <h2>Quem está fora da cadência</h2>
          </div>
          <form className="inline-form" onSubmit={submitSearch}>
            <input
              type="search"
              className="search-input"
              placeholder="Buscar cliente ou telefone"
              aria-label="Buscar cliente no radar"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="submit" className="button button-secondary">
              Buscar
            </button>
          </form>
        </div>

        {radarState() ?? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Último pedido</th>
                  <th>Cadência</th>
                  <th>Próxima estimativa</th>
                  <th>Dias</th>
                  <th>Sinal</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = signal(row)
                  const wa = whatsappLink(
                    row.contact_phone,
                    `Olá, ${row.display_name}! Tudo bem? Já faz ${row.days_since_last} dias desde o último pedido. Quer repetir?`,
                  )
                  return (
                    <tr key={row.customer_id}>
                      <td data-label="Cliente">
                        <strong>{row.display_name}</strong>
                        <small>{formatPhone(row.contact_phone)}</small>
                      </td>
                      <td data-label="Último pedido">{formatDateTime(row.last_order_at)}</td>
                      <td data-label="Cadência">
                        {row.insufficient || row.median_interval_days === null
                          ? '—'
                          : `~${row.median_interval_days} dias`}
                      </td>
                      <td data-label="Próxima estimativa">
                        {row.next_expected_at ? formatDateTime(row.next_expected_at) : '—'}
                      </td>
                      <td data-label="Dias">{row.days_since_last}</td>
                      <td data-label="Sinal">
                        <span className={`badge ${state.tone}`}>{state.label}</span>
                      </td>
                      <td data-label="Ações" className="table-actions">
                        {canWrite && wa && (
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy === row.customer_id}
                            onClick={() => void createReminder(row)}
                          >
                            Lembrar
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy === row.customer_id}
                            onClick={() => void snooze(row, 30)}
                          >
                            Silenciar 30d
                          </button>
                        )}
                        {canWrite && row.snoozed_until && (
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy === row.customer_id}
                            onClick={() => void snooze(row, 0)}
                          >
                            Reativar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

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

        <div className="card-heading">
          <div>
            <span className="eyebrow">Histórico</span>
            <h2>Lembretes recentes</h2>
          </div>
        </div>
        {reminders.length === 0 ? (
          <p className="muted">Nenhum lembrete preparado.</p>
        ) : (
          <ul className="link-list">
            {reminders.map((reminder) => (
              <li key={reminder.id}>
                <div>
                  <strong>
                    {rows.find((row) => row.customer_id === reminder.customer_id)?.display_name ??
                      'Cliente'}
                  </strong>
                  <small>{formatDateTime(reminder.created_at)}</small>
                </div>
                <span className="badge badge-muted">
                  {reminder.status === 'manual_opened' ? 'Aberto manualmente' : reminder.status}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="form-note">
          A cadência usa a mediana dos intervalos entre pedidos confirmados/concluídos e a
          tolerância configurada. Clientes com menos de 3 pedidos aparecem como dados
          insuficientes. O link de WhatsApp é manual e não confirma envio ou entrega.
        </p>
        <Link className="text-link" to="/app/clientes">
          Ver clientes →
        </Link>
      </section>
    </div>
  )
}
