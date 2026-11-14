import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { Billing } from './pages/Billing'
import { Catalog } from './pages/Catalog'
import { Customers } from './pages/Customers'
import { Dashboard } from './pages/Dashboard'
import { Demo } from './pages/Demo'
import { ForgotPassword } from './pages/ForgotPassword'
import { InviteAccept } from './pages/InviteAccept'
import { Landing } from './pages/Landing'
import { Privacy, Terms } from './pages/Legal'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { Onboarding } from './pages/Onboarding'
import { OrderDetail } from './pages/OrderDetail'
import { Orders } from './pages/Orders'
import { PrivatePrices } from './pages/PrivatePrices'
import { QuotePublic } from './pages/QuotePublic'
import { Quotes } from './pages/Quotes'
import { Products } from './pages/Products'
import { Radar } from './pages/Radar'
import { Reorder } from './pages/Reorder'
import { ResetPassword } from './pages/ResetPassword'
import { Signup } from './pages/Signup'
import { Team } from './pages/Team'
import { Tracking } from './pages/Tracking'

const Admin = lazy(() =>
  import('./pages/Admin').then((module) => ({ default: module.Admin })),
)
const Settings = lazy(() =>
  import('./pages/Settings').then((module) => ({ default: module.Settings })),
)

function RouteFallback({ label = 'Carregando…' }: { readonly label?: string }) {
  return (
    <output className="route-loading">{label}</output>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/entrar" element={<Login />} />
          <Route path="/recuperar-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
          <Route path="/criar-conta" element={<Signup />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute requireOrganization={false}>
                <Onboarding />
              </ProtectedRoute>
            }
          />

          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="pedidos" element={<Orders />} />
            <Route path="pedidos/:orderId" element={<OrderDetail />} />
            <Route path="produtos" element={<Products />} />
            <Route path="clientes" element={<Customers />} />
            <Route path="precos" element={<PrivatePrices />} />
            <Route path="orcamentos" element={<Quotes />} />
            <Route path="equipe" element={<Team />} />
            <Route path="radar" element={<Radar />} />
            <Route path="assinatura" element={<Billing />} />
            <Route
              path="configuracoes"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <Settings />
                </Suspense>
              }
            />
          </Route>

          <Route path="/c/:slug" element={<Catalog />} />
          <Route path="/p/:token" element={<Catalog />} />
          <Route path="/o/:token" element={<QuotePublic />} />
          <Route
            path="/convite/:token"
            element={
              <ProtectedRoute requireOrganization={false}>
                <InviteAccept />
              </ProtectedRoute>
            }
          />
          <Route path="/r/:token" element={<Reorder />} />
          <Route path="/acompanhar/:token" element={<Tracking />} />
          <Route
            path="/admin"
            element={
              <Suspense fallback={<RouteFallback label="Carregando console…" />}>
                <Admin />
              </Suspense>
            }
          />
          <Route path="/demo" element={<Demo />} />
          <Route path="/privacidade" element={<Privacy />} />
          <Route path="/termos" element={<Terms />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
