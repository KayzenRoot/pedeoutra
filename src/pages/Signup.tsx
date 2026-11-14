import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { BackendNotice, FormMessage } from '../components/ui'
import { useAuth } from '../context/auth-context'
import { track } from '../lib/analytics'

export function Signup() {
  const { configured, signUp } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!configured) return <BackendNotice />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não conferem.')
      return
    }
    if (!consent) {
      setError('Para criar a conta, aceite os termos e a política de privacidade.')
      return
    }

    setSubmitting(true)
    try {
      const result = await signUp(email.trim(), password)
      track('signup_completed')
      if (result.needsEmailConfirmation) {
        setNeedsConfirmation(true)
      } else {
        navigate('/onboarding', { replace: true })
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Não foi possível criar a conta.')
    } finally {
      setSubmitting(false)
    }
  }

  if (needsConfirmation) {
    return (
      <AuthLayout
        title="Confirme seu e-mail"
        subtitle="Enviamos um link de confirmação para o endereço informado."
        footer={
          <p>
            Já confirmou? <Link to="/entrar">Entrar</Link>
          </p>
        }
      >
        <FormMessage tone="success">
          Abra o e-mail <strong>{email}</strong> e clique no link para ativar a conta. Depois,
          entre para criar sua organização.
        </FormMessage>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Criar conta grátis"
      subtitle="7 dias de teste sem cartão. Um fornecedor por conta."
      footer={
        <p>
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </p>
      }
    >
      <form className="form" onSubmit={handleSubmit}>
        {error && <FormMessage>{error}</FormMessage>}
        <label className="field">
          <span>E-mail</span>
          <input
            type="email"
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
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mínimo de 6 caracteres"
          />
        </label>
        <label className="field">
          <span>Confirmar senha</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repita a senha"
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            Li e aceito os <Link to="/termos">termos de uso</Link> e a{' '}
            <Link to="/privacidade">política de privacidade</Link>. Os documentos são
            preliminares e estão em revisão.
          </span>
        </label>
        <button type="submit" className="button button-primary button-block" disabled={submitting}>
          {submitting ? 'Criando conta…' : 'Criar conta e testar'}
        </button>
        <p className="form-note">
          Não pedimos cartão agora. A assinatura só começa se você decidir continuar após o
          teste.
        </p>
      </form>
    </AuthLayout>
  )
}
