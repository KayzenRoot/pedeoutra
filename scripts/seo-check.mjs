#!/usr/bin/env node
/**
 * Verifica o HTML pré-renderizado e o fallback 404 sem depender de browser.
 * Reproduz localmente as rewrites explícitas do Cloudflare Pages.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const REDIRECTS = readFileSync(join(ROOT, 'public', '_redirects'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [pattern, target, status] = line.split(/\s+/)
    const source = pattern.endsWith('/*')
      ? new RegExp(`^${escapeRegex(pattern.slice(0, -2))}/.*$`)
      : null
    return { pattern, source, target, status: Number(status) }
  })

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function contentType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8'
  if (path.endsWith('.txt')) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

function resolveFile(pathname) {
  const clean = pathname.split('?')[0]
  const candidates = [join(DIST, clean), join(DIST, clean, 'index.html')]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function redirectFor(pathname) {
  const clean = pathname.split('?')[0]
  return REDIRECTS.find((rule) =>
    rule.source ? rule.source.test(clean) : rule.pattern === clean,
  )
}

function serve(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const file = resolveFile(url.pathname)
  if (file) {
    res.writeHead(200, { 'Content-Type': contentType(file) })
    createReadStream(file).pipe(res)
    return
  }
  const redirect = redirectFor(url.pathname)
  if (redirect) {
    const target = join(DIST, redirect.target.replace(/^\//, ''))
    if (existsSync(target)) {
      res.writeHead(redirect.status, { 'Content-Type': contentType(target) })
      createReadStream(target).pipe(res)
      return
    }
  }
  const notFound = join(DIST, '404.html')
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
  if (existsSync(notFound)) createReadStream(notFound).pipe(res)
  else res.end('Not found')
}

async function check(base, path, expectedStatus, needles = []) {
  const response = await fetch(`${base}${path}`)
  const body = await response.text()
  if (response.status !== expectedStatus) {
    throw new Error(`${path}: esperava ${expectedStatus}, recebeu ${response.status}`)
  }
  for (const needle of needles) {
    if (!body.includes(needle)) throw new Error(`${path}: ausente ${needle}`)
  }
  console.log(`  PASS ${path} (${response.status})`)
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('dist/index.html ausente; rode npm run build antes.')
  }
  const server = createServer(serve)
  await new Promise((resolveListen, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  try {
    await check(base, '/', 200, [
      '<h1',
      'Pediu uma vez',
      'PedeOutra Essencial',
      'PedeOutra Profissional',
      '29,90',
      '69,90',
      'pedeoutra-jsonld',
      'canonical',
    ])
    await check(base, '/setores/embalagens', 200, ['distribuidores de embalagens'])
    await check(base, '/privacidade', 200, ['Aviso de privacidade'])
    await check(base, '/rota-inexistente', 404, ['Página não encontrada', 'noindex'])
    await check(base, '/app', 200, ['id="root"'])
    await check(base, '/robots.txt', 200, ['Sitemap:'])
    await check(base, '/sitemap.xml', 200, ['/setores/embalagens'])
    console.log('PASS SEO estático e 404 real')
  } finally {
    server.close()
  }
}

try {
  await main()
} catch (error) {
  console.error(error)
  process.exit(1)
}
