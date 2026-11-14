import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { callAuthedFunction, callAuthedGet, EdgeFunctionError } from '../lib/edge'
import { FormMessage } from './ui'

interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  status: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  expires_at: string | null
}

interface ApiKeyCreateResponse extends ApiKeyRow {
  key: string
  warning: string
}

const SCOPES = [
  { id: 'catalog:read', label: 'Catálogo' },
  { id: 'orders:read', label: 'Pedidos' },
  { id: 'customers:read', label: 'Clientes' },
]

function apiErrorMessage(error: unknown): string {
  if (error instanceof EdgeFunctionError && error.code === 'mfa_required') {
    return 'Ative o MFA TOTP (AAL2) em Segurança para gerenciar chaves de API.'
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function ApiKeysPanel() {
  const { organization, subscription } = useAuth()
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['catalog:read'])
  const [created, setCreated] = useState<ApiKeyCreateResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isProfessional = subscription?.plan_code === 'professional'
  const organizationId = organization?.id

  async function loadKeys() {
    setLoading(true)
    setError(null)
    try {
      const data = await callAuthedGet<{ keys: ApiKeyRow[] }>('api-key-list')
      setKeys(data.keys ?? [])
    } catch (loadError) {
      setError(apiErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isProfessional || !organizationId) {
      setLoading(false)
      return
    }
    void loadKeys()
  }, [isProfessional, organizationId])

  async function createKey(event: FormEvent) {
    event.preventDefault()
    if (scopes.length === 0) {
      setError('Selecione pelo menos um escopo.')
      return
    }
    setBusy('create')
    setError(null)
    setSuccess(null)
    setCreated(null)
    try {
      const key = await callAuthedFunction<ApiKeyCreateResponse>('api-key-create', {
        name: name.trim(),
        scopes,
      })
      setCreated(key)
      setSuccess('Chave criada. Copie agora; ela não será exibida novamente.')
      setName('')
      await loadKeys()
    } catch (createError) {
      setError(apiErrorMessage(createError))
    } finally {
      setBusy(null)
    }
  }

  async function revokeKey(key: ApiKeyRow) {
    if (!window.confirm(`Revogar a chave ${key.name}? Chamadas com ela deixarão de funcionar.`)) {
      return
    }
    setBusy(`revoke-${key.id}`)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('api-key-revoke', { key_id: key.id })
      setSuccess('Chave revogada.')
      await loadKeys()
    } catch (revokeError) {
      setError(apiErrorMessage(revokeError))
    } finally {
      setBusy(null)
    }
  }

  if (!isProfessional) {
    return (
      <section className="card">
        <span className="eyebrow">Integração</span>
        <h2>API B2B</h2>
        <p>
          A API REST de leitura do catálogo, clientes e pedidos exige o Profissional e chaves
          por organização com escopos e revogação.
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
      <h2>API B2B</h2>
      <p className="muted">
        Chaves são exibidas uma única vez e guardadas como hash. A API é somente leitura nesta
        versão, com limite de 10.000 requisições/mês e 60/minuto por chave.
      </p>

      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      {created && (
        <div className="link-created">
          <div>
            <span className="eyebrow">Chave criada</span>
            <input readOnly value={created.key} onFocus={(event) => event.target.select()} />
          </div>
          <p>{created.warning}</p>
        </div>
      )}

      <form className="stack-form" onSubmit={(event) => void createKey(event)}>
        <label className="field">
          <span>Nome da chave</span>
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ERP interno"
          />
        </label>
        <fieldset className="field">
          <legend>Escopos</legend>
          <div className="consent-options">
            {SCOPES.map((scope) => (
              <label className="checkbox-field" key={scope.id}>
                <input
                  type="checkbox"
                  checked={scopes.includes(scope.id)}
                  onChange={(event) =>
                    setScopes((current) =>
                      event.target.checked
                        ? [...current, scope.id]
                        : current.filter((item) => item !== scope.id),
                    )
                  }
                />
                <span>{scope.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="button button-primary" disabled={busy === 'create'}>
          {busy === 'create' ? 'Criando…' : 'Criar chave de API'}
        </button>
      </form>

      {loading ? (
        <p className="muted">Carregando chaves…</p>
      ) : keys.length === 0 ? (
        <p className="muted">Nenhuma chave criada.</p>
      ) : (
        <ul className="link-list">
          {keys.map((key) => (
            <li key={key.id}>
              <div>
                <strong>{key.name}</strong>
                <small>
                  {key.key_prefix}… · {key.scopes.join(', ')} ·{' '}
                  {key.last_used_at ? `usada em ${new Date(key.last_used_at).toLocaleDateString('pt-BR')}` : 'nunca usada'}
                </small>
              </div>
              <span className={`badge ${key.status === 'active' ? 'badge-active' : 'badge-muted'}`}>
                {key.status === 'active' ? 'Ativa' : 'Revogada'}
              </span>
              {key.status === 'active' && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void revokeKey(key)}
                  disabled={busy === `revoke-${key.id}`}
                >
                  Revogar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="form-note">
        A documentação OpenAPI está em <code>/openapi.json</code>. Nunca coloque a chave no
        navegador ou em logs; use-a apenas em servidor.
      </p>
    </section>
  )
}
