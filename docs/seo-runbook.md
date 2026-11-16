# SEO e Search Console — runbook

## Estado atual

- `https://pedeoutra.pages.dev` é o endereço público conhecido.
- Prerender comercial e `404.html` real estão implementados no build.
- `npm run test:seo` valida HTML inicial, canonical, JSON-LD, sitemap, robots,
  rewrites e 404 real na CI.
- **Search Console: `EXTERNAL_SETUP_REQUIRED`.** Nenhuma propriedade Google está
  vinculada ao repositório; não há token de verificação versionado.

## Ativação do Search Console (somente após deploy autorizado)

1. No Google Search Console, criar propriedade do tipo URL-prefix para
   `https://pedeoutra.pages.dev/`.
2. Verificar propriedade por DNS ou arquivo HTML. O token/arquivo de verificação
   fica fora do repositório; nunca colar em issue, PR, log ou Evidence Bundle.
3. Após verificação, enviar `https://pedeoutra.pages.dev/sitemap.xml`.
4. Inspecionar `/`, `/demo`, `/privacidade`, `/termos` e os cinco `/setores/*`.
5. Confirmar que `/app`, `/admin`, `/entrar`, `/criar-conta`, `/onboarding`,
   `/redefinir-senha`, `/r/*`, `/p/*`, `/o/*`, `/convite/*`, `/acompanhar/*` e
   `/c/*` não aparecem como indexáveis.
6. Só então registrar no admin/evidência “Search Console conectado”, com data e
   período; antes disso o estado correto é “não conectado”.

## Core Web Vitals

- Alvos: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 no p75.
- Dados de campo exigem RUM/consentimento e tráfego real; sem isso, usar
  Lighthouse/Chrome sintético e rotular como **synthetic**, nunca como campo.
- Não bloquear animações, consentimento ou CTAs para melhorar score sintético.
- Medir landing desktop/mobile light/dark após deploy autorizado.

## Monitoramento contínuo

- CI: `npm run test:seo` (build + HTML + 404 + sitemap/robots).
- Smoke: axe e navegação pública light/dark/mobile.
- Alertas de 404/5xx e latência: somente após observabilidade de produção
  autorizada; não inventar série histórica.
- Playbook de incidente: perda de indexação, robots bloqueando assets, soft-404,
  domínio/301, HTML sem conteúdo, CSP quebrando assets. Mudanças de conteúdo ou
  robots exigem revisão humana.

## Limitações

- Prerender cobre rotas comerciais; rotas privadas continuam SPA e noindex.
- Catálogo `/c/:slug` é noindex por padrão até opt-in explícito e revisão de
  risco.
- GSC, CWV de campo e dados de consulta só existem após verificação/deploy
  externos autorizados.
