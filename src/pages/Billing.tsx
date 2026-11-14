import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { track } from '../lib/analytics'
import { ACCESS_TEXT, organizationAccess } from '../lib/access'
import { callAuthedFunction, EdgeFunctionError, getPlanCatalog } from '../lib/edge'
import { formatBRL, formatDateTime } from '../lib/format'
import { featureLabel, PLAN_NAMES } from '../lib/plans'
import type {
  CheckoutResponse,
  PlanCatalogResponse,
  PlanCode,
  PublicPlan,
} from '../lib/types'
import { FormMessage, PageHeader } from '../components/ui'

const PLAN_ORDER: Record<PlanCode, number> = { essential: 0, professional: 1 }

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

function planBadge(plan: PublicPlan) {
  if (plan.available) return { label: 'Disponível', className: 'pill pill-lime' }
  return { label: 'Em preparação', className: 'pill pill-muted' }
}

export function Billing() {
  const { organization, subscription, refreshOrganization } = useAuth()
  const [searchParams] = useSearchParams()
  const [plans, setPlans] = useState<PublicPlan[]>([])
  const [plansError, setPlansError] = useState<string | null>(null)
  const [busyPlan, setBusyPlan] = useState<PlanCode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const checkoutNotice = CHECKOUT_NOTICES[searchParams.get('checkout') ?? '']
  const access = organizationAccess(organization, subscription)
  const canCancel = ['active', 'past_due'].includes(subscription?.state ?? '')
  const currentPlan: PlanCode =
    subscription?.plan_code === 'professional' ? 'professional' : 'essential'
  const active = subscription?.state === 'active'

  useEffect(() => {
    let mounted = true
    getPlanCatalog<PlanCatalogResponse>()
      .then((data) => {
        if (!mounted) return
        setPlans([...(data.plans ?? [])].sort((a, b) => PLAN_ORDER[a.plan_code] - PLAN_ORDER[b.plan_code]))
        setPlansError(null)
      })
      .catch(() => {
        if (mounted) setPlansError('Não foi possível carregar os planos agora.')
      })
    return () => {
      mounted = false
    }
  }, [])

  async function startCheckout(planCode: PlanCode) {
    setBusyPlan(planCode)
    setError(null)
    setSuccess(null)
    try {
      track('checkout_started', { plan_code: planCode })
      const result = await callAuthedFunction<CheckoutResponse>('create-checkout', {
        plan_code: planCode,
      })
      window.location.assign(result.checkout_url)
    } catch (checkoutError) {
      if (checkoutError instanceof EdgeFunctionError) {
        setError(checkoutError.message)
      } else {
        setError('Não foi possível iniciar o checkout.')
      }
      setBusyPlan(null)
    }
  }

  async function cancelSubscription() {
    if (!window.confirm('Cancelar a renovação? O acesso continua até o fim do período já pago.')) {
      return
    }
    setBusyPlan('essential')
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
      setBusyPlan(null)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Planos e assinatura"
        title="Seu acesso ao PedeOutra"
        description="O Essencial mantém o preço de R$ 29,90/mês. O Profissional está em preparação e ainda não pode ser contratado."
      />

      {checkoutNotice && (
        <FormMessage tone={checkoutNotice.tone}>{checkoutNotice.text}</FormMessage>
      )}
      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {plansError && <FormMessage>{plansError}</FormMessage>}

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
              <dt>Plano atual</dt>
              <dd>{PLAN_NAMES[currentPlan]}</dd>
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
            {active ? (
              <p className="muted">
                Sua assinatura está ativa. O acesso é renovado conforme o pagamento confirmado.
              </p>
            ) : (
              <p className="muted">
                Escolha o Essencial abaixo. O Profissional só será liberado depois da
                implementação e da auditoria da Parte 2/4.
              </p>
            )}
            {canCancel && (
              <button
                type="button"
                className="button button-danger"
                onClick={() => void cancelSubscription()}
                disabled={busyPlan !== null}
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

        {plans.map((plan) => {
          const badge = planBadge(plan)
          const isCurrent = active && currentPlan === plan.plan_code
          const enabledFeatures = plan.features.filter((feature) => feature.enabled)
          const unavailable = !plan.available
          let action: ReactNode

          if (isCurrent) {
            action = (
              <button type="button" className="button button-secondary" disabled>
                Plano atual
              </button>
            )
          } else if (unavailable) {
            action = (
              <button type="button" className="button button-secondary" disabled>
                Indisponível nesta fase
              </button>
            )
          } else {
            action = (
              <button
                type="button"
                className="button button-primary"
                onClick={() => void startCheckout(plan.plan_code)}
                disabled={busyPlan !== null}
              >
                {busyPlan === plan.plan_code
                  ? 'Abrindo checkout…'
                  : `Assinar ${PLAN_NAMES[plan.plan_code]} por ${formatBRL(plan.price_cents)}/mês`}
              </button>
            )
          }

          return (
            <section className="card plan-card" key={plan.plan_code}>
              <span className={badge.className}>{badge.label}</span>
              <h2>{PLAN_NAMES[plan.plan_code]}</h2>
              <p>
                {plan.plan_code === 'essential'
                  ? 'Para pequenos distribuidores que vendem de novo com frequência.'
                  : 'Recursos avançados de recompra, equipe limitada e API. Disponível após a Parte 2/4.'}
              </p>
              <div className="price-amount price-amount-small">
                <span>R$</span>
                <strong>{(plan.price_cents / 100).toFixed(2).replace('.', ',')}</strong>
                <small>/mês</small>
              </div>
              <ul className="price-list">
                {enabledFeatures.slice(0, 6).map((feature) => (
                  <li key={feature.key}>{featureLabel(feature.key)}</li>
                ))}
                {plan.plan_code === 'professional' && (
                  <li className="muted">Recursos previstos, ainda não contratáveis.</li>
                )}
              </ul>
              <div className="plan-total">
                <span>Cobrança da assinatura</span>
                <strong>{formatBRL(plan.price_cents)}/mês</strong>
              </div>
              <div className="billing-actions">{action}</div>
              <p className="form-note">
                {plan.trial_days > 0
                  ? `${plan.trial_days} dias de teste sem cartão neste plano.`
                  : 'Sem teste gratuito no Profissional nesta versão.'}
              </p>
            </section>
          )
        })}
      </div>

      <p className="form-note">
        O PedeOutra não cobra os pedidos B2B. Pedidos são solicitações comerciais sujeitas à
        confirmação do fornecedor. Veja os <Link to="/termos">termos</Link> e a{' '}
        <Link to="/privacidade">privacidade</Link>.
      </p>
    </div>
  )
}
