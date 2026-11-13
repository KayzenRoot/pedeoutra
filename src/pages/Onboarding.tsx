import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { FormMessage } from '../components/ui'
import { useAuth } from '../context/auth-context'
import { slugify } from '../lib/format'

export function Onboarding() {
  const { createOrganization, user } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [city, setCity] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const previewSlug = slugify(name) || 'seu-fornecedor'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await createOrganization({ name, whatsapp, city })
      navigate('/app', { replace: true })
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Não foi possível criar a organização.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="onboarding">
      <header className="onboarding-header">
        <Brand />
        <span className="muted">Conta: {user?.email}</span>
      </header>
      <main className="onboarding-main">
        <div className="onboarding-copy">
          <span className="eyebrow">Último passo</span>
          <h1>Crie sua organização</h1>
          <p>
            Uma conta, uma organização no MVP. Esses dados aparecem no catálogo público e na
            assinatura. Você pode ajustar nome, WhatsApp e cidade depois.
          </p>
          <ul className="onboarding-list">
            <li>
              <strong>1.</strong> Dados comerciais mínimos
            </li>
            <li>
              <strong>2.</strong> Catálogo e primeiros produtos
            </li>
            <li>
              <strong>3.</strong> Link pronto para compartilhar
            </li>
          </ul>
        </div>

        <form className="onboarding-card form" onSubmit={handleSubmit}>
          {error && <FormMessage>{error}</FormMessage>}
          <label className="field">
            <span>Nome fantasia</span>
            <input
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Distribuidora Aurora"
            />
          </label>
          <label className="field">
            <span>WhatsApp comercial</span>
            <input
              required
              inputMode="tel"
              value={whatsapp}
              onChange={(event) => setWhatsapp(event.target.value)}
              placeholder="(11) 99999-8888"
            />
          </label>
          <label className="field">
            <span>Cidade (opcional)</span>
            <input
              maxLength={80}
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="São Paulo"
            />
          </label>
          <div className="slug-preview">
            Seu catálogo ficará em <strong>/c/{previewSlug}-•••</strong>
          </div>
          <button type="submit" className="button button-primary button-block" disabled={submitting}>
            {submitting ? 'Criando organização…' : 'Criar organização e continuar'}
          </button>
          <p className="form-note">
            O identificador final recebe um sufixo aleatório para evitar colisões. Ele não
            fica editável nesta versão.
          </p>
        </form>
      </main>
    </div>
  )
}
