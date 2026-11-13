import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { BackendNotice, FormMessage } from '../components/ui'
import { useAuth } from '../context/auth-context'

export function Login() {
  const { configured, session, organization, signIn } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!configured) return <BackendNotice />
  if (session) {
    return <Navigate to={organization ? '/app' : '/onboarding'} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      const next = searchParams.get('next')
      navigate(next && next.startsWith('/') ? next : '/app', { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Não foi possível entrar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Entrar no PedeOutra"
      subtitle="Acesse o painel do seu catálogo e dos pedidos."
      footer={
        <>
          <p>
            <Link to="/recuperar-senha">Esqueci minha senha</Link>
          </p>
          <p>
            Ainda não tem conta? <Link to="/criar-conta">Criar conta grátis</Link>
          </p>
        </>
      }
    >
      <form className="form" onSubmit={handleSubmit}>
        {error && <FormMessage>{error}</FormMessage>}
        <label className="field">
          <span>E-mail</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@empresa.com.br"
          />
        </label>
        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
          />
        </label>
        <button type="submit" className="button button-primary button-block" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </AuthLayout>
  )
}
