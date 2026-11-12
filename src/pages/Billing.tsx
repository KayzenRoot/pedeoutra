import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { ACCESS_TEXT, organizationAccess } from '../lib/access'
import { callAuthedFunction, EdgeFunctionError } from '../lib/edge'
import { formatBRL, formatDateTime } from '../lib/format'
import type { CheckoutResponse } from '../lib/types'
import { FormMessage, PageHeader } from '../components/ui'

const CHECKOUT_NOTICES: Record<string, { tone: 'info' | 'success' | 'error'; text: string }> = {
  success: {
    tone: 'info',
    text: 'Checkout concluído no provedor. O acesso será liberado somente após a confirmação do pagamento por webhook validado. Isso pode levar alguns instantes.',
  },
  cancel: {
    tone: 'info',
    text: 'Checkout cancelado. Nenhuma cobrança foi confirmada.',
  },
  expired: {
    tone: 'info',
    text: 'O checkout expirou. Você pode iniciar um novo quando quiser.',
  },
}

export function Billing() {
  const { organization, subscription, refreshOrganization } = useAuth()
  const [searchParams] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const checkoutNotice = CHECKOUT_NOTICES[searchParams.get('checkout') ?? '']
  const access = organizationAccess(organization, subscription)
  const canCancel = ['active', 'past_due'].includes(subscription?.state ?? '')

  async function startCheckout() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await callAuthedFunction<CheckoutResponse>('create-checkout')
      window.location.assign(result.checkout_url)
    } catch (checkoutError) {
      if (checkoutError instanceof EdgeFunctionError) {
        setError(checkoutError.message)
      } else {
        setError('Não foi possível iniciar o checkout.')
      }
      setBusy(false)
    }
  }

  async function cancelSubscription() {
    if (!window.confirm('Cancelar a renovação? O acesso continua até o fim do período já pago.')) {
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('cancel-subscription')
      await refreshOrganization()
      setSuccess('Renovação cancelada. O acesso permanece até o fim do período atual.')
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : 'Não foi possível cancelar a assinatura.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Assinatura"
        title="Seu acesso ao PedeOutra"
        description="Um plano único de R$ 29,90/mês. O teste de 7 dias não pede cartão."
      />

      {checkoutNotice && (
        <FormMessage tone={checkoutNotice.tone}>{checkoutNotice.text}</FormMessage>
      )}
      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      <div className="billing-grid">
        <section className="card billing-status">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Estado atual</span>
              <h2>{ACCESS_TEXT[access.label]}</h2>
            </div>
            <span className={`access-pill access-${access.label}`}>
              {access.label === 'trial' ? 'Teste' : ACCESS_TEXT[access.label]}
            </span>
          </div>

          <dl className="detail-list">
            <div>
              <dt>Organização</dt>
              <dd>{organization?.name}</dd>
            </div>
            <div>
              <dt>Teste termina</dt>
              <dd>{formatDateTime(organization?.trial_ends_at)}</dd>
            </div>
            <div>
              <dt>Assinatura</dt>
              <dd>{subscription?.state ?? 'Ainda não iniciada'}</dd>
            </div>
            {subscription?.current_period_end && (
              <div>
                <dt>Período atual até</dt>
                <dd>{formatDateTime(subscription.current_period_end)}</dd>
              </div>
            )}
            {subscription?.last_verified_at && (
              <div>
                <dt>Última verificação</dt>
                <dd>{formatDateTime(subscription.last_verified_at)}</dd>
              </div>
            )}
          </dl>

          <div className="billing-actions">
            {subscription?.state === 'active' ? (
              <p className="muted">
                Sua assinatura está ativa. O acesso é renovado conforme o pagamento confirmado.
              </p>
            ) : (
              <button
                type="button"
                className="button button-primary"
                onClick={() => void startCheckout()}
                disabled={busy}
              >
                {busy ? 'Abrindo checkout…' : 'Assinar por R$ 29,90/mês'}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                className="button button-danger"
                onClick={() => void cancelSubscription()}
                disabled={busy}
              >
                Cancelar renovação
              </button>
            )}
          </div>

          <p className="form-note">
            O checkout é hospedado pelo Asaas. O PedeOutra não recebe nem armazena dados de
            cartão. A confirmação de acesso depende de evento de pagamento validado no
            servidor.
          </p>
        </section>

        <section className="card plan-card">
          <span className="pill pill-lime">Plano único</span>
          <h2>PedeOutra</h2>
          <p>Para pequenos distribuidores que vendem de novo com frequência.</p>
          <div className="price-amount price-amount-small">
            <span>R$</span>
            <strong>29,90</strong>
            <small>/mês</small>
          </div>
          <ul className="price-list">
            <li>Catálogo público e pedidos ilimitados</li>
            <li>Clientes e links de recompra</li>
            <li>WhatsApp manual e histórico</li>
            <li>Um fornecedor por conta</li>
          </ul>
          <div className="plan-total">
            <span>Cobrança da assinatura</span>
            <strong>{formatBRL(2990)}/mês</strong>
          </div>
          <p className="form-note">
            O PedeOutra não cobra os pedidos B2B. Pedidos são solicitações comerciais sujeitas
            à confirmação do fornecedor.
          </p>
          <Link className="text-link" to="/termos">
            Ler termos preliminares →
          </Link>
        </section>
      </div>
    </div>
  )
}
