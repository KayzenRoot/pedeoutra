import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'

export function NotFound() {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
      </header>
      <main className="public-main">
        <div className="card centered-card">
          <span className="eyebrow">404</span>
          <h1>Página não encontrada</h1>
          <p>O endereço pode estar incorreto ou a página foi movida.</p>
          <div className="centered-actions">
            <Link to="/" className="button button-primary">
              Voltar ao início
            </Link>
            <Link to="/demo" className="button button-secondary">
              Ver demonstração
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
