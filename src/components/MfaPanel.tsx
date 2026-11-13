import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FormMessage } from './ui'

interface TotpFactor {
  id: string
  friendly_name?: string | null
  status: string
}

export function MfaPanel({ onVerified }: { onVerified?: () => void } = {}) {
  const [factor, setFactor] = useState<TotpFactor | null>(null)
  const [level, setLevel] = useState<string>('desconhecido')
  const [nextLevel, setNextLevel] = useState<string>('desconhecido')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function refresh() {
    if (!supabase) return
    const [{ data: factors }, { data: assurance }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
    const totp = (factors?.totp ?? []).find((item) => item.status === 'verified') ?? null
    setFactor(totp)
    setLevel(assurance?.currentLevel ?? 'desconhecido')
    setNextLevel(assurance?.nextLevel ?? 'desconhecido')
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function startEnrollment() {
    if (!supabase) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'PedeOutra',
    })
    if (enrollError || !data) {
      setError('Não foi possível iniciar o MFA. Tente novamente.')
      setBusy(false)
      return
    }
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setFactor({ id: data.id, status: 'unverified', friendly_name: data.friendly_name })
    setBusy(false)
  }

  async function verifyCode() {
    if (!supabase || !factor) return
    const normalized = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(normalized)) {
      setError('Informe o código de 6 dígitos do aplicativo autenticador.')
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: factor.id,
    })
    if (challengeError || !challenge) {
      setError('Não foi possível iniciar a verificação. Tente novamente.')
      setBusy(false)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.id,
      code: normalized,
    })
    if (verifyError) {
      setError('Código inválido ou expirado. Gere um novo código e tente outra vez.')
      setBusy(false)
      return
    }
    setCode('')
    setQrCode(null)
    setSecret(null)
    setSuccess('MFA TOTP confirmado. A sessão elevada é exigida para o console administrativo.')
    await refresh()
    setBusy(false)
    onVerified?.()
  }

  if (!supabase) {
    return <p className="muted">MFA disponível quando o backend estiver configurado.</p>
  }

  function renderMfaAction() {
    if (qrCode) {
      return (
        <div className="mfa-enroll">
          <img src={qrCode} alt="QR code para configurar o aplicativo autenticador" />
          <p>
            Escaneie o QR code ou digite o segredo no aplicativo autenticador e informe o
            código de 6 dígitos.
          </p>
          {secret && (
            <code className="mfa-secret" aria-label="Segredo TOTP">
              {secret}
            </code>
          )}
          <div className="form-actions">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-label="Código de 6 dígitos"
              placeholder="000000"
            />
            <button
              type="button"
              className="button button-primary"
              onClick={() => void verifyCode()}
              disabled={busy}
            >
              {busy ? 'Confirmando…' : 'Confirmar MFA'}
            </button>
          </div>
        </div>
      )
    }

    if (factor?.status === 'verified') {
      return (
        <p>
          <span className="pill pill-lime">MFA ativo</span>{' '}
          {level === 'aal2'
            ? 'Esta sessão já está em AAL2.'
            : 'Confirme o código TOTP ao entrar no console administrativo.'}
        </p>
      )
    }

    return (
      <button
        type="button"
        className="button button-secondary"
        onClick={() => void startEnrollment()}
        disabled={busy}
      >
        {busy ? 'Preparando…' : 'Ativar MFA TOTP'}
      </button>
    )
  }

  return (
    <div className="mfa-panel">
      <p className="muted">
        O console administrativo exige TOTP (AAL2). O nível atual desta sessão é{' '}
        <strong>{level}</strong>.
        {nextLevel === 'aal2' && level !== 'aal2'
          ? ' Há um fator verificado aguardando confirmação.'
          : null}
      </p>

      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {renderMfaAction()}
    </div>
  )
}
