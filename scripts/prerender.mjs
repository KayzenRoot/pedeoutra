#!/usr/bin/env node
/**
 * Gera HTML estático para as rotas comerciais depois do build Vite.
 * O SPA continua hidratando/assumindo as rotas privadas normalmente.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'vite'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')

const ROUTES = [
  {
    path: '/',
    out: 'index.html',
    title: 'PedeOutra — Pediu uma vez? Pede outra!',
    description:
      'Catálogo B2B, pedidos organizados e links de recompra para pequenos distribuidores. Teste o Essencial por 7 dias sem cartão.',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'PedeOutra',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'Catálogo e pedidos recorrentes para pequenos distribuidores, com catálogo público e links de recompra.',
      offers: { '@type': 'Offer', price: '29.90', priceCurrency: 'BRL' },
    },
  },
  {
    path: '/demo',
    out: 'demo/index.html',
    title: 'Demonstração — PedeOutra',
    description: 'Veja um catálogo B2B fictício e simule um pedido sem cadastro de comprador.',
  },
  {
    path: '/privacidade',
    out: 'privacidade/index.html',
    title: 'Aviso de privacidade — PedeOutra',
    description: 'Como o PedeOutra trata dados de fornecedores, compradores e pedidos.',
  },
  {
    path: '/termos',
    out: 'termos/index.html',
    title: 'Termos de uso — PedeOutra',
    description: 'Termos do serviço PedeOutra para fornecedores assinantes.',
  },
  ...[
    ['embalagens', 'Embalagens'],
    ['limpeza', 'Limpeza'],
    ['agua-gelo', 'Água e gelo'],
    ['descartaveis', 'Descartáveis'],
    ['insumos', 'Insumos'],
  ].map(([slug, name]) => ({
    path: `/setores/${slug}`,
    out: `setores/${slug}/index.html`,
    title: `PedeOutra para ${name.toLowerCase()} — catálogo e recompra B2B`,
    description: `Catálogo B2B para distribuidores de ${name.toLowerCase()}, com pedidos, preços por cliente e recompra.`,
  })),
]

function escapeAttr(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function setMeta(html, attribute, key, value) {
  const pattern = new RegExp(
    String.raw`<meta\s+${attribute}="${key}"\s+content="[^"]*"\s*/?>`,
  )
  const tag = `<meta ${attribute}="${key}" content="${escapeAttr(value)}" />`
  if (pattern.test(html)) return html.replace(pattern, tag)
  return html.replace('</head>', `    ${tag}\n  </head>`)
}

function setCanonical(html, href) {
  const tag = `<link rel="canonical" href="${escapeAttr(href)}" />`
  const pattern = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/
  if (pattern.test(html)) return html.replace(pattern, tag)
  return html.replace('</head>', `    ${tag}\n  </head>`)
}

function withHead(template, route, baseUrl) {
  const canonical = `${baseUrl}${route.path === '/' ? '/' : route.path}`
  let html = template
  html = html.replace(/<title>.*?<\/title>/, `<title>${escapeAttr(route.title)}</title>`)
  html = setMeta(html, 'name', 'description', route.description)
  html = setMeta(html, 'property', 'og:title', route.title)
  html = setMeta(html, 'property', 'og:description', route.description)
  html = setMeta(html, 'property', 'og:url', canonical)
  html = setMeta(html, 'name', 'twitter:title', route.title)
  html = setMeta(html, 'name', 'twitter:description', route.description)
  if (route.noindex) html = setMeta(html, 'name', 'robots', 'noindex, nofollow')
  html = setCanonical(html, canonical)
  if (route.jsonLd) {
    const script = `<script id="pedeoutra-jsonld" type="application/ld+json">${JSON.stringify(route.jsonLd)}</script>`
    html = html.replace('</head>', `    ${script}\n  </head>`)
  }
  return html
}

async function main() {
  const baseUrl = (process.env.VITE_APP_URL || 'https://pedeoutra.pages.dev').replace(/\/$/, '')
  const template = await readFile(join(DIST, 'index.html'), 'utf8')
  const vite = await createServer({
    root: ROOT,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  })

  try {
    const { renderPage } = await vite.ssrLoadModule('/src/prerender/entry.tsx')
    await Promise.all(
      ROUTES.map(async (route) => {
        const markup = renderPage(route.path)
        const html = withHead(template, route, baseUrl).replace(
          /<div id="root"><\/div>/,
          `<div id="root">${markup}</div>`,
        )
        const output = join(DIST, route.out)
        await mkdir(dirname(output), { recursive: true })
        await writeFile(output, html, 'utf8')
        console.log(`  prerender ${route.path} -> ${route.out}`)
      }),
    )

    const notFoundMarkup = renderPage('/404')
    const notFound = withHead(
      template,
      {
        path: '/404',
        title: 'Página não encontrada — PedeOutra',
        description: 'O endereço pode estar incorreto ou a página foi movida.',
        noindex: true,
      },
      baseUrl,
    ).replace(
      /<div id="root"><\/div>/,
      `<div id="root">${notFoundMarkup}</div>`,
    )
    await writeFile(join(DIST, '404.html'), notFound, 'utf8')
    console.log('  prerender 404 -> 404.html')
  } finally {
    await vite.close()
  }
}

try {
  await main()
} catch (error) {
  console.error(error)
  process.exit(1)
}
