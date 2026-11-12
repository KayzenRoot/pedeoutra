import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/auth-context'
import { BackendNotice, LoadingScreen } from './ui'

export function ProtectedRoute({
  children,
  requireOrganization = true,
}: {
  children: ReactNode
  requireOrganization?: boolean
}) {
  const { configured, loading, organizationLoading, session, organization } = useAuth()
  const location = useLocation()

  if (!configured) return <BackendNotice />
  if (loading) return <LoadingScreen label="Verificando sessão…" />
  if (!session) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/entrar?next=${encodeURIComponent(next)}`} replace />
  }
  if (organizationLoading) return <LoadingScreen label="Carregando sua organização…" />

  if (requireOrganization && !organization) {
    return <Navigate to="/onboarding" replace />
  }
  if (!requireOrganization && organization) {
    return <Navigate to="/app" replace />
  }

  return <>{children}</>
}
