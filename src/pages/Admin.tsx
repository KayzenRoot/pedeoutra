import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MfaPanel } from '../components/MfaPanel'
import { ThemeToggle } from '../components/ThemeToggle'
import { FormMessage } from '../components/ui'
import { useAuth } from '../context/auth-context'
import { callAuthedFunction, callAuthedGet, EdgeFunctionError } from '../lib/edge'
import { formatBRL, formatDateTime } from '../lib/format'
import { PLAN_NAMES } from '../lib/plans'
import { supabase } from '../lib/supabase'
import type {
  AdminAnalyticsEvent,
  AdminAnalyticsResponse,
  AdminAnalyticsSource,
  AdminAuditEvent,
  AdminAuditResponse,
  AdminOrganization,
  AdminOrganizationsResponse,
  AdminOverview,
  PlanCode,
} from '../lib/types'

const PAGE_SIZE = 10

const STATE_OPTIONS = [
  { value: '', label: 'Todos os estados' },
  { value: 'trial', label: 'Trial ativo' },
  { value: 'active', label: 'Ativo' },
  { value: 'expired', label: 'Expirado' },
  { value: 'blocked', label: 'Bloqueado' },
  { value: 'review', label: 'Revisão de trial' },
]

function adminErrorMessage(error: EdgeFunctionError): string {
  if (error.status === 503) {
    return 'Console indisponível: bootstrap do superadmin não configurado (ADMIN_BOOTSTRAP_BLOCKED).'
  }
  if (error.status === 403) {
    return 'Acesso administrativo indisponível para esta conta.'
  }
  return error.message
}

function accessLabel(state: string): string {
  if (state === 'trial') return 'Trial'
  if (state === 'active') return 'Ativo'
  if (state === 'blocked') return 'Bloqueado'
  if (state === 'expired') return 'Expirado'
  return state
}

export function Admin() {
  const { session, signOut } = useAuth()
  const [level, setLevel] = useState('desconhecido')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([])
  const [audit, setAudit] = useState<AdminAuditEvent[]>([])
  const [analytics, setAnalytics] = useState<AdminAnalyticsEvent[]>([])
  const [analyticsSources, setAnalyticsSources] = useState<AdminAnalyticsSource[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<EdgeFunctionError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(
    async (nextPage: number) => {
      if (!session) return
      setLoading(true)
      setError(null)
      try {
        const [overviewData, listData, auditData, analyticsData] = await Promise.all([
          callAuthedGet<{ overview: AdminOverview }>('admin-api', { view: 'overview' }),
          callAuthedGet<AdminOrganizationsResponse>('admin-api', {
            view: 'organizations',
            search,
            state: stateFilter,
            plan: planFilter,
            limit: PAGE_SIZE,
            offset: nextPage * PAGE_SIZE,
          }),
          callAuthedGet<AdminAuditResponse>('admin-api', {
            view: 'audit',
            limit: 20,
            offset: 0,
          }),
          callAuthedGet<AdminAnalyticsResponse>('admin-api', {
            view: 'analytics',
            days: 30,
          }),
        ])
        setOverview(overviewData.overview)
        setOrganizations(listData.organizations ?? [])
        setTotal(listData.total ?? 0)
        setAudit(auditData.audit ?? [])
        setAnalytics(analyticsData.events ?? [])
        setAnalyticsSources(analyticsData.sources ?? [])
      } catch (loadError) {
        setError(
          loadError instanceof EdgeFunctionError
            ? loadError
            : new EdgeFunctionError('request_failed', 'Falha ao carregar o console.', 500),
        )
      } finally {
        setLoading(false)
      }
    },
    [planFilter, search, session, stateFilter],
  )

  useEffect(() => {
    if (!supabase || !session) return
    let mounted = true
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (!mounted) return
      setLevel(data?.currentLevel ?? 'desconhecido')
    })
    return () => {
      mounted = false
    }
  }, [session])

  useEffect(() => {
    if (session && level === 'aal2') void load(page)
  }, [session, level, load, page])

  async function act(
    organization: AdminOrganization,
    action: string,
    label: string,
  ) {
    const reason = window.prompt(
      `Motivo para ${label} ${organization.name} (5 a 500 caracteres):`,
    )
    if (reason === null) return
    if (reason.trim().length < 5) {
      setNotice('O motivo precisa ter pelo menos 5 caracteres.')
      return
    }
    if (!window.confirm(`Confirmar ${label} de ${organization.name}? A ação será auditada.`)) {
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      await callAuthedFunction('admin-api', {
        action,
        organization_id: organization.organization_id,
        reason: reason.trim(),
      })
      setNotice(`${label} concluído e registrado na auditoria.`)
      await load(page)
    } catch (actionError) {
      setError(
        actionError instanceof EdgeFunctionError
          ? actionError
          : new EdgeFunctionError('request_failed', 'Falha na ação administrativa.', 500),
      )
    } finally {
      setLoading(false)
    }
  }

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  if (!session) {
    return (
      <div className="admin-page">
        <div className="admin-shell admin-fail-closed">
          <ThemeToggle compact />
          <h1>Console administrativo</h1>
          <p>Entre com a conta de operador para continuar.</p>
          <Link className="button button-primary" to="/entrar?next=/admin">
            Entrar
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div>
          <span className="eyebrow">PedeOutra · operadora</span>
          <h1>Console administrativo</h1>
        </div>
        <div className="admin-header-actions">
          <ThemeToggle compact />
          <Link className="text-link" to="/app">
            Área do fornecedor
          </Link>
          <button type="button" className="text-button" onClick={() => void signOut()}>
            Sair
          </button>
        </div>
      </header>

      {level !== 'aal2' ? (
        <div className="admin-shell">
          <section className="card">
            <h2>Confirme o MFA TOTP</h2>
            <p>
              O console exige AAL2 verificado no servidor em cada leitura e escrita. Sem o
              segundo fator, nenhum dado global é retornado.
            </p>
            <MfaPanel onVerified={() => setLevel('aal2')} />
          </section>
        </div>
      ) : (
        <div className="admin-shell">
          {error && <FormMessage>{adminErrorMessage(error)}</FormMessage>}
          {notice && <FormMessage tone="success">{notice}</FormMessage>}

          {overview && (
            <section className="admin-stats" aria-label="Resumo da plataforma">
              {[
                ['Organizações', overview.organizations_total],
                ['Trials ativos', overview.trials_active],
                ['Revisão de trial', overview.trials_review],
                ['Assinaturas ativas', overview.subscriptions_active],
                ['Past due', overview.subscriptions_past_due],
                ['Canceladas', overview.subscriptions_canceled],
                ['Reembolsadas', overview.subscriptions_refunded],
                ['Bloqueadas', overview.organizations_blocked],
                ['Recebido confirmado', formatBRL(overview.confirmed_revenue_cents)],
              ].map(([label, value]) => (
                <div className="admin-stat" key={String(label)}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </section>
          )}

          <section className="card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Funil</span>
                <h2>Analytics first-party (30 dias)</h2>
              </div>
              <span className="muted">Dados observados; ausência ≠ zero</span>
            </div>
            {analytics.length === 0 ? (
              <p className="muted">Nenhum evento consentido no período.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>Sessões</th>
                      <th>Eventos</th>
                      <th>Último</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.map((event) => (
                      <tr key={event.event}>
                        <td data-label="Evento">{event.event}</td>
                        <td data-label="Sessões">{event.sessions}</td>
                        <td data-label="Eventos">{event.events}</td>
                        <td data-label="Último">
                          {event.last_seen ? formatDateTime(event.last_seen) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {analyticsSources.length > 0 && (
              <ul className="settings-list">
                {analyticsSources.slice(0, 8).map((source) => (
                  <li key={`${source.referrer_class}-${source.utm_source ?? 'none'}`}>
                    <strong>{source.referrer_class}</strong> · {source.utm_source ?? 'sem UTM'} ·{' '}
                    {source.sessions} sessão(ões)
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Fornecedores</span>
                <h2>Organizações</h2>
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void load(page)}
                disabled={loading}
              >
                {loading ? 'Atualizando…' : 'Atualizar'}
              </button>
            </div>

            <form
              className="admin-filters"
              onSubmit={(event) => {
                event.preventDefault()
                setPage(0)
                void load(0)
              }}
            >
              <input
                className="search-input"
                placeholder="Buscar nome ou slug"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
                aria-label="Filtrar por estado"
              >
                {STATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={planFilter}
                onChange={(event) => setPlanFilter(event.target.value)}
                aria-label="Filtrar por plano"
              >
                <option value="">Todos os planos</option>
                <option value="essential">Essencial</option>
                <option value="professional">Profissional</option>
              </select>
              <button type="submit" className="button button-primary">
                Filtrar
              </button>
            </form>

            <div className="table-scroll">
              <table className="data-table admin-table">
                <thead>
                  <tr>
                    <th>Organização</th>
                    <th>Plano</th>
                    <th>Acesso</th>
                    <th>Trial / risco</th>
                    <th>Período</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((organization) => (
                    <tr key={organization.organization_id}>
                      <td>
                        <strong>{organization.name}</strong>
                        <small>/{organization.slug}</small>
                      </td>
                      <td>
                        {PLAN_NAMES[organization.plan_code as PlanCode] ??
                          organization.plan_code}
                        <small> v{organization.plan_version}</small>
                      </td>
                      <td>{accessLabel(organization.access_state)}</td>
                      <td>
                        {organization.trial_status}
                        {organization.risk_score > 0 ? ` · risco ${organization.risk_score}` : ''}
                        <small>{formatDateTime(organization.trial_ends_at)}</small>
                      </td>
                      <td>{formatDateTime(organization.current_period_end)}</td>
                      <td className="table-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void act(organization, 'org.suspend', 'suspensão')}
                        >
                          Suspender
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void act(organization, 'org.reactivate', 'reativação')}
                        >
                          Reativar
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void act(organization, 'trial.clear_review', 'limpeza de revisão')}
                        >
                          Limpar revisão
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!organizations.length && !loading && (
                    <tr>
                      <td colSpan={6} className="muted">
                        Nenhuma organização neste filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="admin-pagination">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  const next = Math.max(0, page - 1)
                  setPage(next)
                  void load(next)
                }}
                disabled={page === 0 || loading}
              >
                Anterior
              </button>
              <span>
                Página {page + 1} de {lastPage + 1} · {total} organizações
              </span>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  const next = Math.min(lastPage, page + 1)
                  setPage(next)
                  void load(next)
                }}
                disabled={page >= lastPage || loading}
              >
                Próxima
              </button>
            </div>
          </section>

          <section className="card">
            <span className="eyebrow">Trilha de auditoria</span>
            <h2>Ações administrativas recentes</h2>
            <ul className="admin-audit">
              {audit.map((event) => (
                <li key={event.id}>
                  <strong>{event.action}</strong>{' '}
                  <span className="muted">
                    {formatDateTime(event.created_at)} · {event.status}
                    {event.reason ? ` · ${event.reason}` : ''}
                  </span>
                </li>
              ))}
              {!audit.length && <li className="muted">Nenhum evento registrado.</li>}
            </ul>
            <p className="form-note">
              Tokens, dados de cartão e dados pessoais de compradores não entram nesta trilha.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
