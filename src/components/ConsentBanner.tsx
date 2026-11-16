import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  track,
} from '../lib/analytics'

export function ConsentBanner() {
  const [visible, setVisible] = useState(() => getAnalyticsConsent() === null)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  if (!visible) return null

  function save(analyticsAllowed: boolean, marketingAllowed: boolean) {
    setAnalyticsConsent(analyticsAllowed, marketingAllowed)
    setVisible(false)
    if (analyticsAllowed) track('page_view')
  }

  return (
    <aside className="consent-banner" aria-label="Preferências de privacidade">
      <div>
        <strong>Privacidade e cookies</strong>
        <p>
          Usamos apenas o necessário para login e segurança. Com sua permissão, registramos
          eventos agregados e sem PII para melhorar o produto. Você pode recusar analytics e
          continuar usando o PedeOutra.
        </p>
        <div className="consent-options">
          <label className="checkbox-field">
            <input type="checkbox" checked disabled />
            <span>Necessários (sempre ativos)</span>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={analytics}
              onChange={(event) => setAnalytics(event.target.checked)}
            />
            <span>Analytics first-party</span>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(event) => setMarketing(event.target.checked)}
            />
            <span>Marketing (futuro; nada é enviado hoje)</span>
          </label>
        </div>
        <small>
          Sem IP integral, e-mail, telefone, token ou URL privada. Veja o{' '}
          <Link to="/privacidade">aviso de privacidade</Link>.
        </small>
      </div>
      <div className="consent-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => save(false, false)}
        >
          Apenas necessários
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => save(analytics, marketing)}
        >
          Salvar preferências
        </button>
      </div>
    </aside>
  )
}
