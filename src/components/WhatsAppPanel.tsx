import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { callAuthedFunction, callAuthedGet } from '../lib/edge'
import { FormMessage } from './ui'

interface WhatsAppConfig {
  connection: {
    waba_id: string
    phone_number_id: string
    status: string
    last_error: string | null
    updated_at: string
  } | null
  templates: Array<{
    event: string
    template_name: string
    language: string
    status: string
    updated_at: string
  }>
  outbox: { blocked: number; pending: number; sent: number; failed: number }
  send_enabled: boolean
  encryption_configured: boolean
  webhook_configured: boolean
  provider: string
}

const STATUS_TEXT: Record<string, string> = {
  pending_verification: 'Aguardando verificação',
  connected: 'Conectado',
  disabled: 'Desconectado',
  error: 'Erro de conexão',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function WhatsAppPanel() {
  const { organization, subscription } = useAuth()
  const [config, setConfig] = useState<WhatsAppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [wabaId, setWabaId] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isProfessional = subscription?.plan_code === 'professional'
  const organizationId = organization?.id

  async function loadConfig() {
    if (!organizationId) return
    setLoading(true)
    setError(null)
    try {
      const data = await callAuthedGet<WhatsAppConfig>('whatsapp-config-get')
      setConfig(data)
      setWabaId(data.connection?.waba_id ?? '')
      setPhoneNumberId(data.connection?.phone_number_id ?? '')
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isProfessional || !organizationId) {
      setLoading(false)
      return
    }
    void loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProfessional, organizationId])

  async function saveConnection(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('whatsapp-connect', {
        waba_id: wabaId.trim(),
        phone_number_id: phoneNumberId.trim(),
        access_token: accessToken.trim(),
      })
      setAccessToken('')
      setSuccess(
        'Credenciais guardadas cifradas. A verificação com a Meta e o envio automático continuam desligados.',
      )
      await loadConfig()
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!window.confirm('Desconectar o WhatsApp oficial? O envio automático será interrompido.')) {
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('whatsapp-disconnect', {})
      setAccessToken('')
      setSuccess('Conexão removida. O WhatsApp manual continua disponível.')
      await loadConfig()
    } catch (disconnectError) {
      setError(errorMessage(disconnectError))
    } finally {
      setSaving(false)
    }
  }

  if (!isProfessional) {
    return (
      <section className="card">
        <span className="eyebrow">Integração oficial</span>
        <h2>WhatsApp automático</h2>
        <p>
          O envio de atualizações por WhatsApp oficial exige o Profissional, uma WABA do
          fornecedor e templates aprovados pela Meta. O WhatsApp manual continua disponível
          em todos os planos.
        </p>
        <Link to="/app/assinatura" className="text-link">
          Ver planos e assinatura →
        </Link>
      </section>
    )
  }

  return (
    <section className="card">
      <span className="eyebrow">Integração oficial</span>
      <h2>WhatsApp automático</h2>
      <p className="muted">
        Credenciais são cifradas no servidor. A conexão fica em verificação e nenhum envio
        automático é feito enquanto a Meta e os templates não estiverem aprovados.
      </p>

      {loading ? (
        <p className="muted">Carregando configuração…</p>
      ) : (
        <>
          {error && <FormMessage>{error}</FormMessage>}
          {success && <FormMessage tone="success">{success}</FormMessage>}

          <dl className="detail-list">
            <div>
              <dt>Status</dt>
              <dd>{config?.connection ? STATUS_TEXT[config.connection.status] ?? config.connection.status : 'Não configurado'}</dd>
            </div>
            <div>
              <dt>Envio automático</dt>
              <dd>{config?.send_enabled ? 'Habilitado no servidor' : 'Desligado'}</dd>
            </div>
            <div>
              <dt>Criptografia</dt>
              <dd>{config?.encryption_configured ? 'Configurada' : 'Pendente no servidor'}</dd>
            </div>
            <div>
              <dt>Webhook</dt>
              <dd>{config?.webhook_configured ? 'Configurado' : 'Pendente no servidor'}</dd>
            </div>
            <div>
              <dt>Fila</dt>
              <dd>
                {config?.outbox.pending ?? 0} pendente(s) · {config?.outbox.blocked ?? 0}{' '}
                bloqueado(s) · {config?.outbox.sent ?? 0} enviado(s)
              </dd>
            </div>
          </dl>

          {config?.connection?.last_error && (
            <FormMessage>{config.connection.last_error}</FormMessage>
          )}

          <form className="stack-form" onSubmit={(event) => void saveConnection(event)}>
            <label className="field">
              <span>WABA ID</span>
              <input
                value={wabaId}
                onChange={(event) => setWabaId(event.target.value)}
                placeholder="ID da conta WhatsApp Business"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Phone number ID</span>
              <input
                value={phoneNumberId}
                onChange={(event) => setPhoneNumberId(event.target.value)}
                placeholder="ID do número na Meta"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Token de acesso da Meta</span>
              <input
                type="password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                placeholder="Novo token (não é exibido depois de salvar)"
                autoComplete="new-password"
              />
            </label>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar credenciais cifradas'}
            </button>
            {config?.connection && (
              <button
                type="button"
                className="button button-danger"
                onClick={() => void disconnect()}
                disabled={saving}
              >
                Desconectar
              </button>
            )}
          </form>

          <p className="form-note">
            A verificação real da WABA e o envio dependem de permissões da Meta, templates
            aprovados e da flag de servidor. Não há envio de teste para destinatários reais
            nesta fase.
          </p>
        </>
      )}
    </section>
  )
}
