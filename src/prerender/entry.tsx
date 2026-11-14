import { renderToStaticMarkup } from 'react-dom/server'
import { Route, Routes } from 'react-router-dom'
import { StaticRouter } from 'react-router-dom/server'
import { Demo } from '../pages/Demo'
import { Landing } from '../pages/Landing'
import { Privacy, Terms } from '../pages/Legal'
import { NotFound } from '../pages/NotFound'
import { Sector } from '../pages/Sector'

/**
 * Entry exclusivo do prerender de build. Não roda no browser e não executa
 * efeitos; apenas gera HTML público compartilhável das rotas comerciais.
 */
export function renderPage(path: string): string {
  return renderToStaticMarkup(
    <StaticRouter location={path}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/demo" element={<Demo />} />
        <Route path="/privacidade" element={<Privacy />} />
        <Route path="/termos" element={<Terms />} />
        <Route path="/setores/:slug" element={<Sector />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </StaticRouter>,
  )
}
