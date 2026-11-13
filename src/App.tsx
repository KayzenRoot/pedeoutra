import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { Admin } from './pages/Admin'
import { Billing } from './pages/Billing'
import { Catalog } from './pages/Catalog'
import { Customers } from './pages/Customers'
import { Dashboard } from './pages/Dashboard'
import { Demo } from './pages/Demo'
import { ForgotPassword } from './pages/ForgotPassword'
import { Landing } from './pages/Landing'
import { Privacy, Terms } from './pages/Legal'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { Onboarding } from './pages/Onboarding'
import { OrderDetail } from './pages/OrderDetail'
import { Orders } from './pages/Orders'
import { Products } from './pages/Products'
import { Reorder } from './pages/Reorder'
import { ResetPassword } from './pages/ResetPassword'
import { Settings } from './pages/Settings'
import { Signup } from './pages/Signup'

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
            <Route path="assinatura" element={<Billing />} />
            <Route path="configuracoes" element={<Settings />} />
          </Route>

          <Route path="/c/:slug" element={<Catalog />} />
          <Route path="/r/:token" element={<Reorder />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/privacidade" element={<Privacy />} />
          <Route path="/termos" element={<Terms />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
