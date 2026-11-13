import type { PlanCode } from './types'

export const PLAN_NAMES: Record<PlanCode, string> = {
  essential: 'Essencial',
  professional: 'Profissional',
}

export const FEATURE_LABELS: Record<string, string> = {
  catalog_public: 'Catálogo público',
  products: 'Produtos',
  customers: 'Clientes',
  orders: 'Pedidos',
  order_tracking_link: 'Link de acompanhamento',
  reorder_manual: 'Recompra manual',
  whatsapp_manual: 'WhatsApp manual',
  dashboard_basic: 'Painel e indicadores básicos',
  import_csv: 'Importação CSV/XLSX',
  pdf_nonfiscal: 'PDF não fiscal',
  qr_code: 'QR code do catálogo',
  onboarding_templates: 'Modelos de onboarding',
  sku_quick_order: 'SKU e pedido rápido',
  order_minimum: 'Pedido mínimo e múltiplos',
  referrals: 'Programa de indicação',
  private_prices: 'Tabelas de preço particulares',
  quotes: 'Orçamentos e aceite',
  reorder_radar: 'Radar de recompra',
  inactive_customers: 'Relatório de clientes inativos',
  whatsapp_automation: 'Lembretes automáticos por WhatsApp',
  team: 'Equipe (até 3 usuários)',
  api_access: 'API REST (10.000 req/mês)',
  api_rate: 'Limite de 60 req/minuto',
  api_keys: 'Até 3 chaves de API',
}

export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.replaceAll('_', ' ')
}

export function formatPlanPrice(priceCents: number): string {
  return (priceCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
