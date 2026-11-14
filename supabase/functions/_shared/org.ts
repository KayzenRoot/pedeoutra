import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { isWriteAllowed } from './access.ts'

export interface PublicOrganization {
  id: string
  name: string
  slug: string
  city: string | null
  whatsapp: string
  trial_ends_at: string
  access_state: string
  min_order_cents: number | null
  min_order_items: number | null
  accepting_orders: boolean
}

interface OrgRow {
  id: string
  name: string
  slug: string
  city: string | null
  whatsapp: string
  trial_ends_at: string
  access_state: string
  min_order_cents: number | null
  min_order_items: number | null
}

async function toPublicOrganization(
  supabase: SupabaseClient,
  row: OrgRow,
): Promise<PublicOrganization> {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('state, current_period_end')
    .eq('organization_id', row.id)
    .maybeSingle()

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    city: row.city,
    whatsapp: row.whatsapp,
    trial_ends_at: row.trial_ends_at,
    access_state: row.access_state,
    min_order_cents: row.min_order_cents,
    min_order_items: row.min_order_items,
    accepting_orders: isWriteAllowed({
      trial_ends_at: row.trial_ends_at,
      access_state: row.access_state,
      subscription: subscription ?? null,
    }),
  }
}

export async function findPublicOrganization(
  supabase: SupabaseClient,
  slug: string,
): Promise<PublicOrganization | null> {
  const { data: organization, error } = await supabase
    .from('organizations')
    .select('id, name, slug, city, whatsapp, trial_ends_at, access_state, min_order_cents, min_order_items')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw new Error('organization_lookup_failed')
  if (!organization) return null
  return toPublicOrganization(supabase, organization as OrgRow)
}

export async function findPublicOrganizationById(
  supabase: SupabaseClient,
  id: string,
): Promise<PublicOrganization | null> {
  const { data: organization, error } = await supabase
    .from('organizations')
    .select('id, name, slug, city, whatsapp, trial_ends_at, access_state, min_order_cents, min_order_items')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error('organization_lookup_failed')
  if (!organization) return null
  return toPublicOrganization(supabase, organization as OrgRow)
}
