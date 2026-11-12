import { accessLabel, isWriteAllowed } from '../../supabase/functions/_shared/access'
import type { Organization, Subscription } from './types'

export type { AccessLabel, OrgAccessInput } from '../../supabase/functions/_shared/access'
export { accessLabel, isWriteAllowed }

export interface OrganizationAccess {
  canWrite: boolean
  label: ReturnType<typeof accessLabel>
  trialDaysLeft: number | null
  subscriptionState: string | null
}

export function organizationAccess(
  organization: Organization | null,
  subscription: Subscription | null,
): OrganizationAccess {
  if (!organization) {
    return { canWrite: false, label: 'expired', trialDaysLeft: null, subscriptionState: null }
  }

  const input = {
    trial_ends_at: organization.trial_ends_at,
    access_state: organization.access_state,
    subscription: subscription
      ? { state: subscription.state, current_period_end: subscription.current_period_end }
      : null,
  }

  const trialDaysLeft = Math.ceil(
    (new Date(organization.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  )

  return {
    canWrite: isWriteAllowed(input),
    label: accessLabel(input),
    trialDaysLeft: Number.isFinite(trialDaysLeft) ? trialDaysLeft : null,
    subscriptionState: subscription?.state ?? null,
  }
}

export const ACCESS_TEXT: Record<ReturnType<typeof accessLabel>, string> = {
  trial: 'Teste gratuito',
  active: 'Assinatura ativa',
  past_due: 'Pagamento em atraso',
  canceled: 'Cancelada, com acesso até o fim do período',
  expired: 'Acesso expirado',
  blocked: 'Acesso bloqueado',
}
