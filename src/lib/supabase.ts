import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const isBackendConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient<Database> | null = isBackendConfigured
  ? createClient<Database>(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export class BackendNotConfiguredError extends Error {
  constructor() {
    super('backend_not_configured')
    this.name = 'BackendNotConfiguredError'
  }
}

export function requireSupabase(): SupabaseClient<Database> {
  if (!supabase) throw new BackendNotConfiguredError()
  return supabase
}
