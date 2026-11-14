import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { ACCESS_TEXT, organizationAccess } from '../lib/access'
import { catalogUrl } from '../lib/format'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'
import { CopyButton, Icon } from './ui'

const NAV_ITEMS = [
  { to: '/app', label: 'Painel', icon: 'home' as const, end: true },
  { to: '/app/pedidos', label: 'Pedidos', icon: 'orders' as const },
  { to: '/app/produtos', label: 'Produtos', icon: 'products' as const },
  { to: '/app/clientes', label: 'Clientes', icon: 'customers' as const },
  { to: '/app/precos', label: 'Preços', icon: 'prices' as const },
  { to: '/app/assinatura', label: 'Assinatura', icon: 'billing' as const },
  { to: '/app/configuracoes', label: 'Configurações', icon: 'settings' as const },
]

export function AppShell() {
  const { organization, subscription, user, signOut } = useAuth()

  if (!organization) return null

  const access = organizationAccess(organization, subscription)
  const publicUrl = catalogUrl(organization.slug)

  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand to="/app" />
        <nav className="app-nav" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-account">
          <ThemeToggle compact />
          <span className="account-name">{organization.name}</span>
          <span className="account-email">{user?.email}</span>
          <button type="button" className="text-button" onClick={() => void signOut()}>
            Sair
          </button>
        </div>
      </header>

      {!access.canWrite && (
        <div className="access-banner" role="status">
          <strong>{ACCESS_TEXT[access.label]}.</strong> Seus dados continuam visíveis, mas
          novos produtos, clientes e links estão pausados.{' '}
          <NavLink to="/app/assinatura">Regularizar assinatura →</NavLink>
        </div>
      )}

      <main className="app-main">
        <div className="app-toolbar">
          <div>
            <span className="eyebrow">Catálogo público</span>
            <a
              className="catalog-share"
              href={`/c/${organization.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              {publicUrl} <Icon name="external" />
            </a>
          </div>
          <CopyButton value={publicUrl} label="Copiar link do catálogo" />
        </div>
        <Outlet />
      </main>

      <nav className="mobile-nav" aria-label="Navegação mobile">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
