import { useEffect, useState } from 'react'
import { useAuth } from '../context/auth-context'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import { CopyButton, FormMessage } from './ui'

interface ReferralCode {
  code: string
  link_path: string
  status: string
  max_uses: number
  uses_count: number
  expires_at: string
  created_at: string
}

interface ReferralRow {
  referral_id: string
  display_label: string
  status: string
  review_required: boolean
  reward_status: string | null
  reward_amount_cents: number | null
  created_at: string
  qualified_at: string | null
  total_count: number
}

const STATUS_LABELS: Record<string, string> = {
  invited: 'Convidada',
  signed_up: 'Cadastro feito',
  trial: 'Em teste',
  qualified: 'Pagamento confirmado',
  reward_pending: 'Recompensa pendente',
  reward_granted: 'Recompensa concedida',
  rejected: 'Não elegível',
  reversed: 'Revertida',
}

const REWARD_LABELS: Record<string, string> = {
  pending: 'Pendente de aprovação',
  granted: 'Concedida',
  reversed: 'Revertida',
}

function referralMessage(message: string): string {
  if (message.includes('plan_required')) {
    return 'O programa de indicações não está disponível neste plano.'
  }
  if (message.includes('forbidden') || message.includes('row-level security')) {
    return 'Apenas o proprietário pode gerenciar indicações.'
  }
  return 'Não foi possível carregar as indicações agora.'
}

export function ReferralPanel() {
  const { organization } = useAuth()
  const [code, setCode] = useState<ReferralCode | null>(null)
  const [rows, setRows] = useState<ReferralRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)

  const organizationId = organization?.id
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const shareLink = code ? `${origin}${code.link_path}` : ''

  useEffect(() => {
    if (!supabase || !organizationId) return
    let active = true
    setLoading(true)
    setError(null)
    Promise.all([
      supabase.rpc('api_referral_code_get_or_create', { p_organization_id: organizationId }),
      supabase.rpc('api_referral_list', { p_organization_id: organizationId, p_limit: 25, p_offset: 0 }),
    ]).then(([codeResult, listResult]) => {
      if (!active) return
      if (codeResult.error) {
        setError(referralMessage(codeResult.error.message))
      } else {
        setCode(((codeResult.data ?? [])[0] ?? null) as ReferralCode | null)
      }
      if (!listResult.error) setRows((listResult.data ?? []) as ReferralRow[])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [organizationId])

  async function rotate() {
    if (!supabase || !organizationId) return
    if (
      !window.confirm(
        'Gerar um novo link revoga o código atual. Indicações já registradas continuam válidas. Continuar?',
      )
    ) {
      return
    }
    setRotating(true)
    setError(null)
    setSuccess(null)
    const { data, error: rotateError } = await supabase.rpc('api_referral_code_rotate', {
      p_organization_id: organizationId,
    })
    if (rotateError) {
      setError(referralMessage(rotateError.message))
    } else {
      setCode(((data ?? [])[0] ?? null) as ReferralCode | null)
      setSuccess('Novo link criado. O código anterior foi revogado.')
    }
    setRotating(false)
  }

  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Programa de indicações</span>
          <h2>Indique outros fornecedores</h2>
        </div>
        {code && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void rotate()}
            disabled={rotating}
          >
            {rotating ? 'Gerando…' : 'Gerar novo link'}
          </button>
        )}
      </div>

      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      {loading && <p className="muted">Carregando indicações…</p>}
      {!loading && !code && (
        <p className="muted">Nenhum código ativo. Gere um link para começar.</p>
      )}
      {!loading && code && (
        <>
          <p>
            Compartilhe este link com outro fornecedor. A indicação só conta quando a conta
            indicada tiver o <strong>primeiro pagamento confirmado</strong>. Teste grátis,
            clique ou retorno de checkout não qualificam.
          </p>
          <div className="referral-link-row">
            <code>{shareLink}</code>
            <CopyButton value={shareLink} label="Copiar link de indicação" />
          </div>
          <p className="muted referral-meta">
            {code.uses_count} de {code.max_uses} usos · expira em {formatDate(code.expires_at)} ·
            gerar novo link revoga o anterior
          </p>
          <p className="form-note">
            A recompensa fica <strong>pendente de aprovação financeira</strong>. Nenhum crédito,
            desconto ou alteração de assinatura é aplicado automaticamente. Autoindicação e
            telefone comercial idêntico entram em revisão.
          </p>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Indicação</th>
                  <th>Status</th>
                  <th>Recompensa</th>
                  <th>Registrada em</th>
                  <th>Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Nenhuma indicação registrada ainda.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.referral_id}>
                      <td data-label="Indicação">{row.display_label}</td>
                      <td data-label="Status">
                        {STATUS_LABELS[row.status] ?? row.status}
                        {row.review_required && <small className="cell-sub">Em revisão</small>}
                      </td>
                      <td data-label="Recompensa">
                        {row.reward_status
                          ? (REWARD_LABELS[row.reward_status] ?? row.reward_status)
                          : '—'}
                      </td>
                      <td data-label="Registrada em">{formatDate(row.created_at)}</td>
                      <td data-label="Pagamento">{formatDate(row.qualified_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
