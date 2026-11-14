import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { callAuthedFunction, callAuthedGet, EdgeFunctionError } from '../lib/edge'
import { FormMessage } from './ui'

interface WebhookRow {
  id: string
  url: string
  events: string[]
  status: string
  created_at: string
  last_delivery_at: string | null
  last_error: string | null
}

interface WebhookCreateResponse extends WebhookRow {
  secret: string
  warning: string
}

const EVENTS = [
  { id: 'order.created', label: 'Pedido criado' },
  { id: 'order.confirmed', label: 'Pedido confirmado' },
  { id: 'order.completed', label: 'Pedido concluído' },
  { id: 'order.canceled', label: 'Pedido cancelado' },
]

function webhookError(error: unknown): string {
  if (error instanceof EdgeFunctionError && error.code === 'mfa_required') {
    return 'Ative o MFA TOTP (AAL2) em Segurança para gerenciar webhooks.'
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function ApiWebhooksPanel() {
  const { organization, subscription } = useAuth()
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([])
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['order.confirmed'])
  const [created, setCreated] = useState<WebhookCreateResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isProfessional = subscription?.plan_code === 'professional'
  const organizationId = organization?.id

  async function loadWebhooks() {
    setLoading(true)
    setError(null)
    try {
      const data = await callAuthedGet<{ webhooks: WebhookRow[] }>('api-webhook-list')
      setWebhooks(data.webhooks ?? [])
    } catch (loadError) {
      setError(webhookError(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isProfessional || !organizationId) {
      setLoading(false)
      return
    }
    void loadWebhooks()
  }, [isProfessional, organizationId])

  async function createWebhook(event: FormEvent) {
    event.preventDefault()
    if (events.length === 0) {
      setError('Selecione pelo menos um evento.')
      return
    }
    setBusy('create')
    setError(null)
    setSuccess(null)
    setCreated(null)
    try {
      const webhook = await callAuthedFunction<WebhookCreateResponse>('api-webhook-create', {
        url: url.trim(),
        events,
      })
      setCreated(webhook)
      setSuccess('Webhook criado. Copie o segredo agora.')
      setUrl('')
      await loadWebhooks()
    } catch (createError) {
      setError(webhookError(createError))
    } finally {
      setBusy(null)
    }
  }

  async function revokeWebhook(webhook: WebhookRow) {
    if (!window.confirm(`Revogar o webhook ${webhook.url}?`)) return
    setBusy(`revoke-${webhook.id}`)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('api-webhook-revoke', { webhook_id: webhook.id })
      setSuccess('Webhook revogado.')
      await loadWebhooks()
    } catch (revokeError) {
      setError(webhookError(revokeError))
    } finally {
      setBusy(null)
    }
  }

  if (!isProfessional) {
    return (
      <section className="card">
        <span className="eyebrow">Integração</span>
        <h2>Webhooks B2B</h2>
        <p>
          Receba eventos de pedido assinados no seu endpoint. Disponível no Profissional, com
          entrega desligada por padrão até configuração operacional.
        </p>
        <Link to="/app/assinatura" className="text-link">
          Ver planos e assinatura →
        </Link>
      </section>
    )
  }

  return (
    <section className="card">
      <span className="eyebrow">Integração</span>
      <h2>Webhooks B2B</h2>
      <p className="muted">
        Entrega assinada com HMAC SHA-256 em `x-pedeoutra-signature`, retry limitado e
        idempotência por entrega. A fila permanece desligada no servidor por padrão.
      </p>

      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      {created && (
        <div className="link-created">
          <div>
            <span className="eyebrow">Segredo do webhook</span>
            <input readOnly value={created.secret} onFocus={(event) => event.target.select()} />
          </div>
          <p>{created.warning}</p>
        </div>
      )}

      <form className="stack-form" onSubmit={(event) => void createWebhook(event)}>
        <label className="field">
          <span>URL HTTPS do endpoint</span>
          <input
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://erp.exemplo.com/webhooks/pedeoutra"
          />
        </label>
        <fieldset className="field">
          <legend>Eventos</legend>
          <div className="consent-options">
            {EVENTS.map((event) => (
              <label className="checkbox-field" key={event.id}>
                <input
                  type="checkbox"
                  checked={events.includes(event.id)}
                  onChange={(changeEvent) =>
                    setEvents((current) =>
                      changeEvent.target.checked
                        ? [...current, event.id]
                        : current.filter((item) => item !== event.id),
                    )
                  }
                />
                <span>{event.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="button button-primary" disabled={busy === 'create'}>
          {busy === 'create' ? 'Criando…' : 'Criar webhook'}
        </button>
      </form>

      {loading ? (
        <p className="muted">Carregando webhooks…</p>
      ) : webhooks.length === 0 ? (
        <p className="muted">Nenhum webhook criado.</p>
      ) : (
        <ul className="link-list">
          {webhooks.map((webhook) => (
            <li key={webhook.id}>
              <div>
                <strong>{webhook.url}</strong>
                <small>{webhook.events.join(', ')}</small>
                {webhook.last_error && <small>Erro: {webhook.last_error}</small>}
              </div>
              <span className={`badge ${webhook.status === 'active' ? 'badge-active' : 'badge-muted'}`}>
                {webhook.status === 'active' ? 'Ativo' : 'Revogado'}
              </span>
              {webhook.status === 'active' && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void revokeWebhook(webhook)}
                  disabled={busy === `revoke-${webhook.id}`}
                >
                  Revogar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="form-note">
        O endpoint deve responder 2xx. Entregas não confirmadas podem ser repetidas; use o
        header de idempotência para deduplicar.
      </p>
    </section>
  )
}
