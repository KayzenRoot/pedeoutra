/**
 * Contrato dos dois planos. Preço/moeda/versão vêm sempre do banco
 * (plan_catalog); este módulo só valida códigos e disponibilidade.
 */
export const PLAN_CODES = ['essential', 'professional'] as const
export type PlanCode = (typeof PLAN_CODES)[number]

export const ESSENTIAL_PRICE_CENTS = 2990
export const PROFESSIONAL_PRICE_CENTS = 6990
export const PLAN_CURRENCY = 'BRL'

export interface PlanCatalogRow {
  plan_code: PlanCode
  plan_version: number
  price_cents: number
  currency: string
  trial_days: number
  active: boolean
  effective_from: string
}

export interface PlanPricing {
  plan_code: string
  plan_version: number
  price_cents: number
  currency: string
  trial_days: number
}

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && (PLAN_CODES as readonly string[]).includes(value)
}

export function planPricing(row: PlanCatalogRow): PlanPricing {
  return {
    plan_code: row.plan_code,
    plan_version: row.plan_version,
    price_cents: row.price_cents,
    currency: row.currency,
    trial_days: row.trial_days,
  }
}

export function isProfessionalCheckoutEnabled(
  readEnv: (name: string) => string | undefined,
): boolean {
  return (readEnv('PRO_PLAN_CHECKOUT_ENABLED') ?? '').trim().toLowerCase() === 'true'
}

export function planAvailability(
  planCode: PlanCode,
  readEnv: (name: string) => string | undefined,
): { available: boolean; reason: string | null } {
  if (planCode === 'essential') return { available: true, reason: null }
  if (isProfessionalCheckoutEnabled(readEnv)) return { available: true, reason: null }
  return { available: false, reason: 'PRO_PLAN_CHECKOUT_DISABLED' }
}

export function planLabel(planCode: string): string {
  return planCode === 'professional' ? 'Profissional' : 'Essencial'
}
