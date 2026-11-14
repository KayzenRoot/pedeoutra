import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { callAuthedFunction, callAuthedGet, EdgeFunctionError } from '../lib/edge'
import { CopyButton, FormMessage, PageHeader } from '../components/ui'

interface TeamMember {
  id: string
  email: string
  role: string
  status: string
  created_at: string
  revoked_at: string | null
}

interface TeamInvitation {
  id: string
  email: string
  role: string
  expires_at: string
  created_at: string
  accepted_at: string | null
  revoked_at: string | null
}

interface TeamListResponse {
  members: TeamMember[]
  invitations: TeamInvitation[]
  limit: number
}

interface InviteResponse {
  invitation_id: string
  url: string
  expires_at: string
  email_sent: boolean
  delivery: string
  message: string
}

type TeamRole = 'manager' | 'operator' | 'viewer'

const ROLE_TEXT: Record<string, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  operator: 'Operador',
  viewer: 'Visualizador',
}

function roleText(role: string): string {
  return ROLE_TEXT[role] ?? role
}

function errorMessage(error: unknown): string {
  if (error instanceof EdgeFunctionError && error.code === 'mfa_required') {
    return 'Ative a autenticação em dois fatores (TOTP) em Configurações para gerenciar a equipe.'
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function Team() {
  const { organization, membershipRole } = useAuth()
  const [team, setTeam] = useState<TeamListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('operator')
  const [invite, setInvite] = useState<InviteResponse | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isOwner = (membershipRole ?? 'owner') === 'owner'
  const organizationId = organization?.id

  async function loadTeam() {
    if (!organizationId) return
    setLoading(true)
    setError(null)
    try {
      setTeam(await callAuthedGet<TeamListResponse>('team-list'))
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOwner || !organizationId) {
      setLoading(false)
      return
    }
    void loadTeam()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, organizationId])

  async function inviteMember(event: FormEvent) {
    event.preventDefault()
    setBusy('invite')
    setError(null)
    setSuccess(null)
    setInvite(null)
    try {
      const result = await callAuthedFunction<InviteResponse>('team-invite', {
        email: email.trim(),
        role,
      })
      setInvite(result)
      setSuccess('Convite criado. Copie o link e envie ao convidado.')
      setEmail('')
      await loadTeam()
    } catch (inviteError) {
      setError(errorMessage(inviteError))
    } finally {
      setBusy(null)
    }
  }

  async function changeRole(member: TeamMember, nextRole: string) {
    setBusy(`role-${member.id}`)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('team-role', {
        membership_id: member.id,
        role: nextRole,
      })
      setSuccess(`Papel de ${member.email} atualizado.`)
      await loadTeam()
    } catch (roleError) {
      setError(errorMessage(roleError))
    } finally {
      setBusy(null)
    }
  }

  async function revokeMember(member: TeamMember) {
    if (!window.confirm(`Remover ${member.email} da equipe? O acesso será bloqueado imediatamente.`)) {
      return
    }
    setBusy(`revoke-${member.id}`)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('team-revoke', { membership_id: member.id })
      setSuccess(`${member.email} foi removido da equipe.`)
      await loadTeam()
    } catch (revokeError) {
      setError(errorMessage(revokeError))
    } finally {
      setBusy(null)
    }
  }

  async function revokeInvitation(invitation: TeamInvitation) {
    setBusy(`invite-${invitation.id}`)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('team-revoke', { invitation_id: invitation.id })
      setSuccess('Convite revogado.')
      await loadTeam()
    } catch (revokeError) {
      setError(errorMessage(revokeError))
    } finally {
      setBusy(null)
    }
  }

  if (!isOwner) {
    return (
      <div>
        <PageHeader eyebrow="Equipe" title="Equipe" description="Gestão de acessos da organização." />
        <section className="card centered-card">
          <h2>Apenas o proprietário gerencia a equipe</h2>
          <p>Peça ao proprietário da conta para alterar papéis ou remover acessos.</p>
          <Link to="/app" className="button button-secondary">
            Voltar ao painel
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Equipe"
        title="Equipe e permissões"
        description="Até 3 usuários no Profissional: proprietário, gerente, operador e visualizador. Convites usam link manual enquanto o SMTP não está configurado."
        action={<span className="muted">{team?.members.length ?? 0} de {team?.limit ?? 3} usuários</span>}
      />

      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      {invite && (
        <div className="link-created">
          <div>
            <span className="eyebrow">Link do convite</span>
            <input readOnly value={invite.url} onFocus={(event) => event.target.select()} />
          </div>
          <div className="link-created-actions">
            <CopyButton value={invite.url} label="Copiar convite" />
          </div>
          <p>{invite.message}</p>
        </div>
      )}

      <div className="two-column">
        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Convite</span>
              <h2>Adicionar pessoa</h2>
            </div>
          </div>
          <form className="stack-form" onSubmit={(event) => void inviteMember(event)}>
            <label className="field">
              <span>E-mail do convidado</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="pessoa@empresa.com"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Papel</span>
              <select value={role} onChange={(event) => setRole(event.target.value as TeamRole)}>
                <option value="manager">Gerente — catálogo, pedidos, preços e orçamentos</option>
                <option value="operator">Operador — clientes e pedidos, sem preços/configurações</option>
                <option value="viewer">Visualizador — somente leitura</option>
              </select>
            </label>
            <button type="submit" className="button button-primary" disabled={busy === 'invite'}>
              {busy === 'invite' ? 'Criando convite…' : 'Criar link de convite'}
            </button>
          </form>
          <p className="form-note">
            O convidado precisa entrar com o mesmo e-mail verificado. O link expira em 7 dias e
            só pode ser usado uma vez. O envio automático de e-mail não está disponível.
          </p>
        </section>

        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Acessos</span>
              <h2>Membros ativos</h2>
            </div>
            <button type="button" className="text-button" onClick={() => void loadTeam()}>
              Atualizar
            </button>
          </div>
          {loading ? (
            <p className="muted">Carregando equipe…</p>
          ) : (team?.members.length ?? 0) === 0 ? (
            <p className="muted">Nenhum membro encontrado.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>E-mail</th>
                    <th>Papel</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {team?.members.map((member) => (
                    <tr key={member.id} className={member.status === 'revoked' ? 'row-muted' : ''}>
                      <td data-label="E-mail">
                        <strong>{member.email || '—'}</strong>
                        <small>{member.status === 'active' ? 'Ativo' : 'Revogado'}</small>
                      </td>
                      <td data-label="Papel">
                        {member.role === 'owner' ? (
                          roleText(member.role)
                        ) : (
                          <select
                            value={member.role}
                            onChange={(event) => void changeRole(member, event.target.value)}
                            disabled={busy === `role-${member.id}`}
                            aria-label={`Papel de ${member.email}`}
                          >
                            <option value="manager">Gerente</option>
                            <option value="operator">Operador</option>
                            <option value="viewer">Visualizador</option>
                          </select>
                        )}
                      </td>
                      <td data-label="Ações" className="table-actions">
                        {member.role !== 'owner' && member.status === 'active' && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void revokeMember(member)}
                            disabled={busy === `revoke-${member.id}`}
                          >
                            Remover
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Pendentes</span>
            <h2>Convites aguardando aceite</h2>
          </div>
        </div>
        {(team?.invitations.length ?? 0) === 0 ? (
          <p className="muted">Nenhum convite pendente.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>Expira</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {team?.invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td data-label="E-mail">{invitation.email}</td>
                    <td data-label="Papel">{roleText(invitation.role)}</td>
                    <td data-label="Expira">
                      {new Date(invitation.expires_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td data-label="Ações" className="table-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void revokeInvitation(invitation)}
                        disabled={busy === `invite-${invitation.id}`}
                      >
                        Revogar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="form-note">
          A revogação bloqueia o acesso imediatamente no banco e nas APIs. Sessões abertas não
          mantêm escrita privilegiada.
        </p>
      </section>
    </div>
  )
}
