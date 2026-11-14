import type { Database } from './database.types'

export type Organization = Database['public']['Tables']['organizations']['Row']
export type Product = Database['public']['Tables']['products']['Row']
export type ProductCategory = Database['public']['Tables']['product_categories']['Row']
export type ProductImage = Database['public']['Tables']['product_images']['Row']
export type Customer = Database['public']['Tables']['customers']['Row']
export type Order = Database['public']['Tables']['orders']['Row']
export type OrderItem = Database['public']['Tables']['order_items']['Row']
export type OrderStatusEvent = Database['public']['Tables']['order_status_events']['Row']
export type Subscription = Database['public']['Tables']['subscriptions']['Row']
export type ReorderLink = Database['public']['Views']['reorder_links_safe']['Row']

export type OrderStatus = 'new' | 'confirmed' | 'completed' | 'canceled'

export interface PublicCatalogResponse {
  organization: {
    name: string
    slug: string
    city: string | null
    whatsapp: string
    min_order_cents: number | null
    min_order_items: number | null
  }
  categories: Array<{
    id: string
    name: string
    slug: string
    position: number
  }>
  products: Array<{
    id: string
    name: string
    unit: string
    price_cents: number | null
    sku: string | null
    min_quantity: number
    quantity_increment: number
    category_id: string | null
    images: Array<{
      id: string
      alt_text: string
      is_cover: boolean
      url: string | null
      thumb_url: string | null
    }>
  }>
  accepting_orders: boolean
}

export interface ReorderGetResponse {
  supplier: {
    name: string
    slug: string
    city: string | null
    whatsapp: string
  }
  items: Array<{
    product_id: string
    name: string
    unit: string
    price_cents: number | null
    quantity: number
  }>
  accepting_orders: boolean
  expires_at: string
  catalog_url: string
}

export interface SubmitOrderResponse {
  status: 'submitted'
  public_reference: string
  total_cents: number | null
  item_count: number
}

export interface CreateReorderLinkResponse {
  link_id: string
  url: string
  expires_at: string
}

export interface CheckoutResponse {
  checkout_url: string
  checkout_id: string
  plan_code: string
  plan_version: number
  price_cents: number
  currency: string
  cycle: string
}

export type PlanCode = 'essential' | 'professional'

export interface PlanFeature {
  key: string
  enabled: boolean
  limit_value: number | null
  limit_window: string | null
}

export interface PublicPlan {
  plan_code: PlanCode
  plan_version: number
  price_cents: number
  currency: string
  trial_days: number
  available: boolean
  unavailable_reason: string | null
  features: PlanFeature[]
}

export interface PlanCatalogResponse {
  plans: PublicPlan[]
}

export interface EffectivePlan {
  plan_code: string
  plan_version: number
  access_kind: string
  access_until: string | null
}

export interface AdminOverview {
  organizations_total: number
  trials_active: number
  trials_review: number
  subscriptions_active: number
  subscriptions_past_due: number
  subscriptions_canceled: number
  subscriptions_refunded: number
  organizations_blocked: number
  confirmed_revenue_cents: number
}

export interface AdminOrganization {
  organization_id: string
  name: string
  slug: string
  access_state: string
  trial_ends_at: string
  trial_status: string
  risk_score: number
  created_at: string
  plan_code: string
  plan_version: number
  subscription_state: string | null
  current_period_end: string | null
  total_count: number
}

export interface AdminAuditEvent {
  id: string
  actor_user_id: string | null
  action: string
  target_organization_id: string | null
  reason: string | null
  status: string
  created_at: string
  total_count: number
}

export interface AdminOrganizationsResponse {
  organizations: AdminOrganization[]
  total: number
}

export interface AdminAuditResponse {
  audit: AdminAuditEvent[]
  total: number
}

export interface OrderWithCustomer extends Order {
  customers: { display_name: string } | null
}

export interface OrderItemDetail extends OrderItem {
  products: { active: boolean } | null
}


export interface CatalogTemplateItem {
  key: string
  name: string
  category: string
  unit: string
  min_quantity: number
  quantity_increment: number
}

export interface CatalogTemplate {
  code: string
  name: string
  description: string
  version: number
  items: CatalogTemplateItem[]
}

export interface CatalogTemplatesResponse {
  templates: CatalogTemplate[]
}
