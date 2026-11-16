import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { FormMessage, LoadingScreen } from '../components/ui'
import { useAuth } from '../context/auth-context'
import { callAuthedFunction, EdgeFunctionError } from '../lib/edge'

const ROLE_TEXT: Record<string, string> = {
  manager: 'Gerente',
  operator: 'Operador',
  viewer: 'Visualizador',
}

export function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  const { user, refreshOrganization } = useAuth()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [role, setRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.append(meta)
    return () => meta.remove()
  }, [])

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setError('Convite inválido.')
      return
    }
    let active = true
    setStatus('loading')
    callAuthedFunction<{ organization_id: string; role: string }>('team-accept', { token })
      .then(async (result) => {
        if (!active) return
        setRole(result.role)
        setStatus('success')
        await refreshOrganization()
      })
      .catch((acceptError) => {
        if (!active) return
        setStatus('error')
        if (acceptError instanceof EdgeFunctionError) {
          if (acceptError.code === 'invitation_email_mismatch') {
            setError('Este convite foi enviado para outro e-mail. Entre com a conta correta.')
          } else if (acceptError.code === 'email_not_verified') {
            setError('Confirme seu e-mail antes de aceitar o convite.')
          } else if (acceptError.code === 'plan_required') {
            setError('A equipe deste fornecedor não está ativa no momento.')
          } else {
            setError(acceptError.message)
          }
        } else {
          setError('Não foi possível aceitar o convite.')
        }
      })
    return () => {
      active = false
    }
  }, [token, refreshOrganization])

  if (status === 'loading') return <LoadingScreen label="Aceitando convite…" />

  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        {user?.email && <span className="public-supplier">{user.email}</span>}
      </header>
      <main className="public-main">
        <div className="card centered-card">
          {status === 'success' ? (
            <>
              <span className="eyebrow">Convite aceito</span>
              <h1>Bem-vindo à equipe</h1>
              <p>
                Seu acesso foi vinculado como <strong>{ROLE_TEXT[role ?? ''] ?? role}</strong>.
                As permissões são verificadas no servidor a cada operação.
              </p>
              <Link to="/app" className="button button-primary">
                Abrir painel
              </Link>
            </>
          ) : (
            <>
              <span className="eyebrow">Convite</span>
              <h1>Não foi possível aceitar</h1>
              <FormMessage>{error}</FormMessage>
              <p>
                Peça ao proprietário um novo link. O convite expira em 7 dias e só funciona com
                o e-mail convidado verificado.
              </p>
              <Link to="/app" className="button button-secondary">
                Voltar ao painel
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
