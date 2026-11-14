import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MfaPanel } from '../components/MfaPanel'
import { WhatsAppPanel } from '../components/WhatsAppPanel'
import { ApiKeysPanel } from '../components/ApiKeysPanel'
import { ThemeToggle } from '../components/ThemeToggle'
import { FormMessage, PageHeader } from '../components/ui'
import { useAuth } from '../context/auth-context'
import { getPlanCatalog } from '../lib/edge'
import { centsToInput, formatBRL, formatDateTime, parsePriceToCents } from '../lib/format'
import { featureLabel } from '../lib/plans'
import { supabase } from '../lib/supabase'
import type { PlanCatalogResponse, PlanCode, PublicPlan } from '../lib/types'

function limitWindowLabel(window: string | null): string {
  if (window === 'month') return 'por mês'
  if (window === 'minute') return 'por minuto'
  return 'no total'
}

const PLAN_LABEL: Record<PlanCode, string> = {
  essential: 'Essencial',
  professional: 'Profissional',
}

export function Settings() {
  const { organization, subscription, refreshOrganization } = useAuth()
  const [name, setName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [city, setCity] = useState('')
  const [minOrder, setMinOrder] = useState('')
  const [minItems, setMinItems] = useState('')
  const [reorderMinHistory, setReorderMinHistory] = useState('3')
  const [reorderTolerance, setReorderTolerance] = useState('3')
  const [remindersEnabled, setRemindersEnabled] = useState(false)
  const [reminderFrequency, setReminderFrequency] = useState('7')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [plans, setPlans] = useState<PublicPlan[]>([])

  useEffect(() => {
    setName(organization?.name ?? '')
    setWhatsapp(organization?.whatsapp ?? '')
    setCity(organization?.city ?? '')
    setMinOrder(centsToInput(organization?.min_order_cents ?? null))
    setMinItems(organization?.min_order_items ? String(organization.min_order_items) : '')
    setReorderMinHistory(String(organization?.reorder_min_history ?? 3))
    setReorderTolerance(String(organization?.reorder_tolerance_days ?? 3))
    setRemindersEnabled(organization?.reorder_reminder_enabled ?? false)
    setReminderFrequency(String(organization?.reorder_reminder_frequency_days ?? 7))
  }, [organization])

  useEffect(() => {
    let mounted = true
    getPlanCatalog<PlanCatalogResponse>()
      .then((data) => {
        if (mounted) setPlans(data.plans ?? [])
      })
      .catch(() => {
        if (mounted) setPlans([])
      })
    return () => {
      mounted = false
    }
  }, [])

  const currentPlan = (subscription?.plan_code as PlanCode | undefined) ?? 'essential'
  const catalog = plans.find((plan) => plan.plan_code === currentPlan)
  const limits = (catalog?.features ?? []).filter(
    (feature) => feature.enabled && feature.limit_value !== null,
  )

  async function saveOrganization(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !organization) return
    const digits = whatsapp.replace(/\D/g, '')
    if (name.trim().length < 2) {
      setError('Informe o nome da empresa com pelo menos 2 caracteres.')
      return
    }
    if (!/^\d{10,15}$/.test(digits)) {
      setError('Informe um WhatsApp válido com DDD.')
      return
    }
    const minOrderCents = minOrder.trim() ? parsePriceToCents(minOrder) : null
    if (minOrder.trim() && minOrderCents === null) {
      setError('Valor mínimo inválido. Use, por exemplo, 50,00.')
      return
    }
    const minOrderItems = minItems.trim() ? Number(minItems) : null
    if (
      minOrderItems !== null &&
      (!Number.isInteger(minOrderItems) || minOrderItems < 1 || minOrderItems > 1000)
    ) {
      setError('A quantidade mínima de itens deve ficar entre 1 e 1000.')
      return
    }
    const minHistory = Number(reorderMinHistory)
    const tolerance = Number(reorderTolerance)
    const frequency = Number(reminderFrequency)
    if (!Number.isInteger(frequency) || frequency < 1 || frequency > 90) {
      setError('A frequência dos lembretes deve ficar entre 1 e 90 dias.')
      return
    }
    if (!Number.isInteger(minHistory) || minHistory < 2 || minHistory > 10) {
      setError('O histórico mínimo do radar deve ficar entre 2 e 10 pedidos.')
      return
    }
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 30) {
      setError('A tolerância do radar deve ficar entre 0 e 30 dias.')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        name: name.trim(),
        whatsapp: digits,
        city: city.trim() || null,
        min_order_cents: minOrderCents,
        min_order_items: minOrderItems,
        reorder_min_history: minHistory,
        reorder_tolerance_days: tolerance,
        reorder_reminder_enabled: remindersEnabled,
        reorder_reminder_channel: 'manual',
        reorder_reminder_frequency_days: frequency,
      })
      .eq('id', organization.id)
    if (updateError) {
      setError('Não foi possível salvar os dados. Tente novamente.')
      setSaving(false)
      return
    }
    await refreshOrganization()
    setSuccess('Dados da empresa atualizados.')
    setSaving(false)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Configurações"
        title="Conta, aparência e limites"
        description="Dados reais da sua operação, preferência de tema, segurança e o que está disponível hoje."
      />

      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      <div className="settings-grid">
        <section className="card">
          <span className="eyebrow">Conta e empresa</span>
          <h2>Dados do fornecedor</h2>
          <form className="stack-form" onSubmit={(event) => void saveOrganization(event)}>
            <label className="field">
              <span>Nome da empresa</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span>WhatsApp comercial</span>
              <input
                value={whatsapp}
                onChange={(event) => setWhatsapp(event.target.value)}
                inputMode="tel"
              />
            </label>
            <label className="field">
              <span>Cidade (opcional)</span>
              <input value={city} onChange={(event) => setCity(event.target.value)} />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Pedido mínimo (R$, opcional)</span>
                <input
                  inputMode="decimal"
                  value={minOrder}
                  onChange={(event) => setMinOrder(event.target.value)}
                  placeholder="50,00"
                />
              </label>
              <label className="field">
                <span>Mínimo de itens (opcional)</span>
                <input
                  inputMode="numeric"
                  value={minItems}
                  onChange={(event) => setMinItems(event.target.value)}
                  placeholder="2"
                />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Histórico mínimo do radar</span>
                <input
                  inputMode="numeric"
                  value={reorderMinHistory}
                  onChange={(event) => setReorderMinHistory(event.target.value)}
                  placeholder="3"
                />
              </label>
              <label className="field">
                <span>Tolerância do radar (dias)</span>
                <input
                  inputMode="numeric"
                  value={reorderTolerance}
                  onChange={(event) => setReorderTolerance(event.target.value)}
                  placeholder="3"
                />
              </label>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={(event) => setRemindersEnabled(event.target.checked)}
              />
              <span>Ativar lembretes manuais de reposição no radar</span>
            </label>
            <label className="field">
              <span>Frequência máxima dos lembretes (dias)</span>
              <input
                inputMode="numeric"
                value={reminderFrequency}
                onChange={(event) => setReminderFrequency(event.target.value)}
                placeholder="7"
              />
            </label>
            <p className="form-note">
              O canal é manual: o fornecedor abre o WhatsApp com um clique. Envio automático
              depende da integração oficial e de opt-in do comprador.
            </p>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar dados'}
            </button>
          </form>
          <p className="form-note">
            O nome e o WhatsApp aparecem no catálogo público. Não informe dados de
            compradores aqui.
          </p>
        </section>

        <section className="card">
          <span className="eyebrow">Aparência</span>
          <h2>Tema da interface</h2>
          <p>
            A preferência fica neste navegador. O modo Sistema acompanha a configuração do
            seu dispositivo.
          </p>
          <ThemeToggle />
          <p className="form-note">
            Os tokens de contraste são aplicados em todas as telas, inclusive catálogo,
            pedidos, assinatura e configurações.
          </p>
        </section>

        <section className="card">
          <span className="eyebrow">Plano e limites</span>
          <h2>{PLAN_LABEL[currentPlan]}</h2>
          <dl className="detail-list">
            <div>
              <dt>Assinatura</dt>
              <dd>{subscription?.state ?? 'Ainda não iniciada'}</dd>
            </div>
            <div>
              <dt>Teste termina</dt>
              <dd>{formatDateTime(organization?.trial_ends_at)}</dd>
            </div>
            {catalog && (
              <div>
                <dt>Preço do plano</dt>
                <dd>{formatBRL(catalog.price_cents)}/mês</dd>
              </div>
            )}
            {limits.map((feature) => (
              <div key={feature.key}>
                <dt>{featureLabel(feature.key)}</dt>
                <dd>
                  {feature.limit_value?.toLocaleString('pt-BR')}{' '}
                  {limitWindowLabel(feature.limit_window)}
                </dd>
              </div>
            ))}
          </dl>
          <Link className="text-link" to="/app/assinatura">
            Ver planos e assinatura →
          </Link>
          <p className="form-note">
            O Profissional está em preparação. Nenhum recurso Premium é liberado antes de
            pagamento confirmado e da implementação correspondente.
          </p>
        </section>

        <section className="card">
          <span className="eyebrow">Segurança</span>
          <h2>Autenticação em dois fatores</h2>
          <MfaPanel />
        </section>

        <section className="card">
          <span className="eyebrow">Integrações</span>
          <h2>O que está disponível</h2>
          <ul className="settings-list">
            <li>
              <strong>WhatsApp manual:</strong> links pré-preenchidos acionados por você.
              Nenhuma mensagem automática.
            </li>
            <li>
              <strong>WhatsApp oficial:</strong> previsto para a Parte 2; exige conta e custos
              do fornecedor, com revisão da Meta. Não disponível.
            </li>
            <li>
              <strong>Meta Ads:</strong> exclusivo da operadora PedeOutra; nunca é herdado por
              Essencial ou Profissional.
            </li>
            <li>
              <strong>API REST:</strong> contrato do Profissional previsto para a Parte 4. Não
              há chaves ativas nesta fase.
            </li>
          </ul>
        </section>

        <WhatsAppPanel />

        <ApiKeysPanel />

        <section className="card">
          <span className="eyebrow">Privacidade e ajuda</span>
          <h2>Transparência</h2>
          <p>
            Consulte o <Link to="/privacidade">aviso de privacidade</Link>, os{' '}
            <Link to="/termos">termos</Link> e a página de demonstração. Pedidos e clientes
            permanecem privados por organização.
          </p>
          <p className="form-note">
            PedeOutra 2.0 em preparação — Parte 1/5. O lançamento comercial continua bloqueado
            até SMTP, backup/continuidade, suporte/legal e autorização da primeira cobrança.
            Nenhuma versão é declarada pronta apenas por esta tela.
          </p>
        </section>
      </div>
    </div>
  )
}
