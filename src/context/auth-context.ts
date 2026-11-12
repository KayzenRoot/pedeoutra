import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { Organization, Subscription } from '../lib/types'

export interface SignUpResult {
  needsEmailConfirmation: boolean
}

export interface AuthContextValue {
  configured: boolean
  loading: boolean
  organizationLoading: boolean
  session: Session | null
  user: User | null
  organization: Organization | null
  subscription: Subscription | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<SignUpResult>
  signOut: () => Promise<void>
  createOrganization: (input: {
    name: string
    whatsapp: string
    city: string
  }) => Promise<Organization>
  refreshOrganization: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return context
}
