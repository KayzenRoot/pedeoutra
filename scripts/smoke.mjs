#!/usr/bin/env node
/**
 * Smoke do build estático.
 * Se houver Chrome/Chromium, executa um smoke real de UI e salva screenshots.
 * Sem browser, cai para verificação HTTP do shell e dos assets.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SCREENSHOTS_DIR = join(ROOT, 'evidence', 'screenshots')
const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

function findBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    process.platform === 'win32' && 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    process.platform === 'win32' && 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.platform === 'win32' && 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const PORT = await findFreePort()
const BASE = `http://127.0.0.1:${PORT}`
const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

const child = spawn(
  process.execPath,
  [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
)

let output = ''
child.stdout?.on('data', (chunk) => {
  output += String(chunk)
})
child.stderr?.on('data', (chunk) => {
  output += String(chunk)
})

function stop() {
  if (child.exitCode === null) {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`vite preview encerrou com código ${child.exitCode}.\n${output}`)
    }
    try {
      const response = await fetch(`${BASE}/`)
      if (response.ok) return
    } catch {
      // servidor ainda subindo
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`vite preview não respondeu.\n${output}`)
}

async function staticSmoke() {
  const routes = ['/', '/demo', '/privacidade', '/termos', '/rota-inexistente']
  for (const route of routes) {
    const response = await fetch(`${BASE}${route}`)
    const body = await response.text()
    if (!response.ok) throw new Error(`${route} retornou ${response.status}`)
    if (!body.includes('id="root"') || !body.includes('PedeOutra')) {
      throw new Error(`${route} não devolveu o shell esperado`)
    }
    console.log(`  PASS ${route} (${response.status}, shell SPA)`)
  }

  const index = await (await fetch(`${BASE}/`)).text()
  const assetMatches = [...index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
    (match) => match[1],
  )
  for (const asset of assetMatches) {
    const response = await fetch(`${BASE}${asset}`)
    if (!response.ok) throw new Error(`asset ${asset} retornou ${response.status}`)
    console.log(`  PASS ${asset} (${response.status})`)
  }
}

async function runAxe(page, label) {
  await page.addScriptTag({ path: AXE_PATH })
  const result = await page.evaluate(async () => {
    return await globalThis.axe.run(globalThis.document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    })
  })

  const blocking = result.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )

  if (blocking.length > 0) {
    const detail = blocking
      .map(
        (violation) =>
          `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes.length} nó(s)`,
      )
      .join('\n')
    throw new Error(`Acessibilidade ${label}:\n${detail}`)
  }

  console.log(
    `  PASS axe ${label} (${result.violations.length} violações; 0 serious/critical)`,
  )
}

async function browserSmoke(browserPath) {
  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch {
    console.log('playwright-core indisponível; usando fallback HTTP.')
    return false
  }

  mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const errors = []
    const context = await browser.newContext({
      viewport: { width: 1360, height: 900 },
      locale: 'pt-BR',
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: /Pediu uma vez/i }).waitFor()
    await runAxe(page, 'landing desktop')
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, 'landing-desktop.png'),
      fullPage: true,
    })
    console.log('  PASS / (landing desktop renderizada)')

    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Bella Limpeza' }).waitFor()
    await runAxe(page, 'demo desktop')
    await page.getByLabel('Nome fictício').fill('Empresa de Teste')
    await page.getByLabel(/Entendo que esta é uma simulação/i).check()
    await page.getByRole('button', { name: /Simular envio do pedido/i }).click()
    await page.getByRole('heading', { name: /Pedido demonstrativo enviado/i }).waitFor()
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, 'demo-sucesso-desktop.png'),
      fullPage: true,
    })
    console.log('  PASS /demo (fluxo fictício completo)')

    await page.goto(`${BASE}/privacidade`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Aviso de privacidade' }).waitFor()
    await page.goto(`${BASE}/termos`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Termos de uso' }).waitFor()
    console.log('  PASS /privacidade e /termos')

    await page.goto(`${BASE}/rota-inexistente`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Página não encontrada' }).waitFor()
    console.log('  PASS rota 404 (SPA fallback)')

    await context.close()

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'pt-BR',
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
    const mobilePage = await mobile.newPage()
    mobilePage.on('pageerror', (error) => errors.push(error.message))

    await mobilePage.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await mobilePage.getByRole('heading', { name: /Pediu uma vez/i }).waitFor()
    await runAxe(mobilePage, 'landing mobile')
    await mobilePage.screenshot({
      path: join(SCREENSHOTS_DIR, 'landing-mobile.png'),
      fullPage: true,
    })

    await mobilePage.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
    await mobilePage.getByRole('heading', { name: 'Bella Limpeza' }).waitFor()
    await runAxe(mobilePage, 'demo mobile')
    await mobilePage.screenshot({
      path: join(SCREENSHOTS_DIR, 'demo-mobile.png'),
      fullPage: true,
    })
    await mobile.close()

    if (errors.length > 0) {
      throw new Error(`Erros de runtime no browser:\n${errors.join('\n')}`)
    }

    console.log('  PASS screenshots salvos em evidence/screenshots/')
    return true
  } finally {
    await browser.close()
  }
}

try {
  await waitForServer()
  console.log(`Smoke em ${BASE}`)
  const browserPath = findBrowserExecutable()
  let browserRan = false

  if (browserPath) {
    console.log(`Browser: ${browserPath}`)
    browserRan = await browserSmoke(browserPath)
  } else {
    console.log('Nenhum Chrome/Chromium encontrado; fallback HTTP.')
  }

  if (!browserRan) await staticSmoke()

  console.log('\nPASS smoke do build estático')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  stop()
}
