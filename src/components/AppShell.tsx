import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { ACCESS_TEXT, organizationAccess } from '../lib/access'
import { catalogUrl } from '../lib/format'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'
import { CopyButton, Icon } from './ui'

const ALL_ROLES = ['owner', 'manager', 'operator', 'viewer']
const NAV_ITEMS = [
  { to: '/app', label: 'Painel', icon: 'home' as const, end: true, roles: ALL_ROLES },
  { to: '/app/pedidos', label: 'Pedidos', icon: 'orders' as const, roles: ALL_ROLES },
  { to: '/app/produtos', label: 'Produtos', icon: 'products' as const, roles: ALL_ROLES },
  { to: '/app/clientes', label: 'Clientes', icon: 'customers' as const, roles: ALL_ROLES },
  { to: '/app/radar', label: 'Radar', icon: 'radar' as const, roles: ALL_ROLES },
  { to: '/app/precos', label: 'Preços', icon: 'prices' as const, roles: ['owner', 'manager'] },
  { to: '/app/orcamentos', label: 'Orçamentos', icon: 'quotes' as const, roles: ['owner', 'manager'] },
  { to: '/app/equipe', label: 'Equipe', icon: 'team' as const, roles: ['owner'] },
  { to: '/app/assinatura', label: 'Assinatura', icon: 'billing' as const, roles: ['owner'] },
  { to: '/app/configuracoes', label: 'Configurações', icon: 'settings' as const, roles: ['owner'] },
]

const MOBILE_NAV_ITEMS = NAV_ITEMS.filter(
  (item) => item.to !== '/app/orcamentos' && item.to !== '/app/equipe',
)

export function AppShell() {
  const { organization, subscription, user, membershipRole, signOut } = useAuth()

  if (!organization) return null

  const access = organizationAccess(organization, subscription)
  const role = membershipRole ?? 'owner'
  const navItems = NAV_ITEMS.filter((item) => item.roles.includes(role))
  const mobileNavItems = MOBILE_NAV_ITEMS.filter((item) => item.roles.includes(role))
  const publicUrl = catalogUrl(organization.slug)

  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand to="/app" />
        <nav className="app-nav" aria-label="Navegação principal">
          {navItems.map((item) => (
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
        {mobileNavItems.map((item) => (
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
