import type { Session } from '@supabase/supabase-js'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { isBackendConfigured, supabase } from '../lib/supabase'
import type { Organization, Subscription } from '../lib/types'
import {
  AuthContext,
  type AuthContextValue,
  type SignUpResult,
} from './auth-context'

function authErrorMessage(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de entrar.'
  }
  if (normalized.includes('user already registered')) {
    return 'Este e-mail já tem conta. Tente entrar.'
  }
  if (normalized.includes('password should be at least')) {
    return 'A senha precisa ter pelo menos 6 caracteres.'
  }
  if (normalized.includes('rate limit')) {
    return 'Muitas tentativas. Aguarde alguns minutos.'
  }
  return 'Não foi possível concluir. Tente novamente.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [organizationLoading, setOrganizationLoading] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const loadSequence = useRef(0)

  const loadOrganization = useCallback(async (userId: string) => {
    if (!supabase) return
    const sequence = loadSequence.current + 1
    loadSequence.current = sequence
    setOrganizationLoading(true)

    try {
      const { data: org } = await supabase
        .from('organizations')
        .select('*')
        .eq('owner_user_id', userId)
        .maybeSingle()

      let sub: Subscription | null = null
      if (org) {
        const { data } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('organization_id', org.id)
          .maybeSingle()
        sub = data ?? null
      }

      if (loadSequence.current === sequence) {
        setOrganization(org ?? null)
        setSubscription(sub)
      }
    } finally {
      if (loadSequence.current === sequence) setOrganizationLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!supabase || !isBackendConfigured) {
      setLoading(false)
      return
    }

    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
      if (data.session?.user) void loadOrganization(data.session.user.id)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession?.user) {
        void loadOrganization(nextSession.user.id)
      } else {
        setOrganization(null)
        setSubscription(null)
      }
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [loadOrganization])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Backend não configurado.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(authErrorMessage(error.message))
  }, [])

  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    if (!supabase) throw new Error('Backend não configurado.')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw new Error(authErrorMessage(error.message))
    return { needsEmailConfirmation: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setOrganization(null)
    setSubscription(null)
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Backend não configurado.')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    if (error) {
      throw new Error('Não foi possível enviar o e-mail de recuperação. Tente novamente.')
    }
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Backend não configurado.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      throw new Error('Não foi possível atualizar a senha. O link pode ter expirado.')
    }
  }, [])

  const createOrganization = useCallback(
    async (input: { name: string; whatsapp: string; city: string }) => {
      if (!supabase) throw new Error('Backend não configurado.')
      const { data, error } = await supabase.rpc('create_organization', {
        p_name: input.name.trim(),
        p_whatsapp: input.whatsapp.replace(/\D/g, ''),
        p_city: input.city.trim() || undefined,
      })
      if (error) {
        if (error.message.includes('organization_exists')) {
          throw new Error('Esta conta já tem uma organização.')
        }
        if (error.message.includes('invalid_whatsapp')) {
          throw new Error('Informe um WhatsApp válido com DDD.')
        }
        throw new Error('Não foi possível criar a organização. Revise os dados.')
      }
      setOrganization(data)
      setSubscription(null)
      return data
    },
    [],
  )

  const refreshOrganization = useCallback(async () => {
    if (session?.user) await loadOrganization(session.user.id)
  }, [loadOrganization, session?.user])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isBackendConfigured,
      loading,
      organizationLoading,
      session,
      user: session?.user ?? null,
      organization,
      subscription,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      createOrganization,
      refreshOrganization,
    }),
    [
      loading,
      organizationLoading,
      session,
      organization,
      subscription,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      createOrganization,
      refreshOrganization,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
