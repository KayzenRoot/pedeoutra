import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { BackendNotice, FormMessage } from '../components/ui'
import { useAuth } from '../context/auth-context'

export function ForgotPassword() {
  const { configured, requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!configured) return <BackendNotice />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await requestPasswordReset(email)
      setSent(true)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Não foi possível solicitar a recuperação.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Enviaremos um link seguro para você definir uma nova senha."
      footer={
        <p>
          Lembrou a senha? <Link to="/entrar">Voltar para entrar</Link>
        </p>
      }
    >
      {sent ? (
        <FormMessage tone="success">
          Se este e-mail estiver cadastrado, enviaremos um link de recuperação em alguns
          minutos. Confira também a caixa de spam.
        </FormMessage>
      ) : (
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
          <button
            type="submit"
            className="button button-primary button-block"
            disabled={submitting}
          >
            {submitting ? 'Enviando…' : 'Enviar link de recuperação'}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
