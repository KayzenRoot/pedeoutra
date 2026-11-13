import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { BackendNotice, FormMessage } from '../components/ui'
import { useAuth } from '../context/auth-context'

export function ResetPassword() {
  const { configured, loading, session, organization, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!configured) return <BackendNotice />

  if (loading) {
    return (
      <AuthLayout title="Validando link" subtitle="Aguarde enquanto validamos seu link.">
        <p className="muted">Validando o link de recuperação…</p>
      </AuthLayout>
    )
  }

  if (!session) {
    return (
      <AuthLayout
        title="Link inválido ou expirado"
        subtitle="Solicite um novo link para redefinir sua senha."
        footer={
          <p>
            <Link to="/recuperar-senha">Solicitar novo link</Link>
          </p>
        }
      >
        <FormMessage>
          O link de recuperação não é mais válido. Por segurança, ele expira e só pode ser
          usado uma vez.
        </FormMessage>
      </AuthLayout>
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }
    setSubmitting(true)
    try {
      await updatePassword(password)
      navigate(organization ? '/app' : '/onboarding', { replace: true })
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Não foi possível atualizar a senha.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Definir nova senha"
      subtitle="Escolha uma senha nova para acessar sua conta."
      footer={
        <p>
          <Link to="/entrar">Voltar para entrar</Link>
        </p>
      }
    >
      <form className="form" onSubmit={handleSubmit}>
        {error && <FormMessage>{error}</FormMessage>}
        <label className="field">
          <span>Nova senha</span>
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
          <span>Confirmar nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repita a nova senha"
          />
        </label>
        <button
          type="submit"
          className="button button-primary button-block"
          disabled={submitting}
        >
          {submitting ? 'Salvando…' : 'Salvar nova senha'}
        </button>
      </form>
    </AuthLayout>
  )
}
