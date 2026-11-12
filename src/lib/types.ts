import type { Database } from './database.types'

export type Organization = Database['public']['Tables']['organizations']['Row']
export type Product = Database['public']['Tables']['products']['Row']
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
  }
  products: Array<{
    id: string
    name: string
    unit: string
    price_cents: number | null
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
  price_cents: number
  cycle: string
}

export interface OrderWithCustomer extends Order {
  customers: { display_name: string } | null
}

export interface OrderItemDetail extends OrderItem {
  products: { active: boolean } | null
}
