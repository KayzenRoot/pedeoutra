import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from './Brand'
import { Icon } from './ui'

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Brand />
        <div>
          <span className="eyebrow">Recompra B2B</span>
          <h2>Sua próxima venda começa no pedido anterior.</h2>
          <ul className="auth-points">
            <li>
              <Icon name="check" /> Catálogo no celular do cliente
            </li>
            <li>
              <Icon name="check" /> Pedido organizado no painel
            </li>
            <li>
              <Icon name="check" /> Link de recompra seguro
            </li>
          </ul>
        </div>
        <p className="auth-aside-note">
          Teste 7 dias sem cartão. Depois, R$ 29,90/mês.
        </p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <Link to="/" className="auth-back">
            ← Voltar ao site
          </Link>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
