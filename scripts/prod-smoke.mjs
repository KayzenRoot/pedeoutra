#!/usr/bin/env node
/**
 * Smoke de produção/staging contra uma URL publicada.
 * Cria dados sintéticos: conta, organização, produto, pedido público e recompra.
 * Requer Chrome/Chromium e playwright-core.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APP_URL = (process.env.APP_URL ?? 'https://pedeoutra.pages.dev').replace(/\/+$/, '')
const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'evidence', 'prod-smoke')
const CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (!chrome) throw new Error('Chrome/Chromium não encontrado')

const stamp = Date.now()
const EMAIL = `smoke+${stamp}@pedeoutra.test`
const PASSWORD = 'Teste123!seguro'
const ORG_NAME = `Distribuidora Smoke ${stamp}`
const PRODUCT_NAME = `Copo Smoke ${stamp}`

mkdirSync(OUT, { recursive: true })

async function main() {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const errors = []
  try {
    const supplier = await browser.newContext({
      viewport: { width: 1360, height: 900 },
      locale: 'pt-BR',
      colorScheme: 'light',
      forcedColors: 'none',
    })
    const page = await supplier.newPage()
    page.setDefaultTimeout(25000)
    page.on('pageerror', (error) => errors.push(error.message))

    console.log(`Smoke de produção em ${APP_URL}`)
    await page.goto(`${APP_URL}/criar-conta`, { waitUntil: 'networkidle' })
    await page.getByLabel('E-mail').fill(EMAIL)
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirmar senha').fill(PASSWORD)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: /Criar conta e testar/i }).click()

    await page.getByRole('heading', { name: /Crie sua organização/i }).waitFor()
    console.log('  PASS signup + autoconfirm')

    await page.getByLabel('Nome fantasia').fill(ORG_NAME)
    await page.getByLabel(/WhatsApp comercial/i).fill('(11) 99999-8888')
    await page.getByLabel(/Cidade/i).fill('São Paulo')
    await page.getByRole('button', { name: /Criar organização e continuar/i }).click()

    await page.getByRole('heading', { name: /Olá/i }).waitFor()
    console.log('  PASS onboarding + organização')
    await page.screenshot({ path: join(OUT, 'dashboard.png'), fullPage: true })

    await page.goto(`${APP_URL}/app/produtos`, { waitUntil: 'networkidle' })
    await page.getByLabel('Nome do produto').fill(PRODUCT_NAME)
    await page.getByLabel('Unidade').fill('cento')
    await page.getByLabel(/Preço/i).fill('12,50')
    await page.getByRole('button', { name: /Cadastrar produto/i }).click()
    await page.getByText('Produto cadastrado.').waitFor()
    console.log('  PASS produto criado')

    const catalogHref = await page.locator('a.catalog-share').getAttribute('href')
    if (!catalogHref) throw new Error('Link do catálogo não encontrado')
    const catalogUrl = new URL(catalogHref, APP_URL).toString()
    await page.screenshot({ path: join(OUT, 'produtos.png'), fullPage: true })

    const buyer = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'pt-BR',
      colorScheme: 'light',
      forcedColors: 'none',
      isMobile: true,
      hasTouch: true,
    })
    const buyerPage = await buyer.newPage()
    buyerPage.setDefaultTimeout(25000)
    buyerPage.on('pageerror', (error) => errors.push(error.message))

    await buyerPage.goto(catalogUrl, { waitUntil: 'networkidle' })
    await buyerPage.getByRole('heading', { name: ORG_NAME }).waitFor()
    await buyerPage.getByRole('button', { name: 'Adicionar' }).first().click()
    await buyerPage.getByLabel(/Seu nome ou empresa/i).fill('Padaria Smoke')
    await buyerPage.getByLabel(/Telefone comercial/i).fill('(11) 97777-6666')
    await buyerPage.getByRole('checkbox').check()
    await buyerPage.getByRole('button', { name: /Enviar pedido para análise/i }).click()
    await buyerPage.getByRole('heading', { name: /Recebemos seu pedido para análise/i }).waitFor()
    const reference = (await buyerPage.locator('.success-summary strong').first().innerText()).trim()
    if (!/^PD-[0-9A-F]{10}$/.test(reference)) throw new Error(`Referência inválida: ${reference}`)
    console.log(`  PASS pedido público ${reference}`)
    await buyerPage.screenshot({ path: join(OUT, 'pedido-sucesso.png'), fullPage: true })

    await page.goto(`${APP_URL}/app/pedidos`, { waitUntil: 'networkidle' })
    await page.getByText(reference).first().waitFor()
    await page.getByRole('link', { name: /Abrir/i }).first().click()
    await page.getByRole('heading', { name: reference }).waitFor()
    await page.screenshot({ path: join(OUT, 'pedido-detalhe.png'), fullPage: true })

    await page.getByRole('button', { name: /Vincular como cliente/i }).click()
    await page.getByRole('button', { name: /Gerar link de recompra/i }).waitFor()
    await page.getByRole('button', { name: /Gerar link de recompra/i }).click()
    await page.locator('.link-created input').waitFor()
    const reorderUrl = await page.locator('.link-created input').inputValue()
    if (!reorderUrl.includes('/r/')) throw new Error('URL de recompra inválida')
    console.log('  PASS vínculo + link de recompra')
    await page.screenshot({ path: join(OUT, 'recompra-link.png'), fullPage: true })

    await buyerPage.goto(reorderUrl, { waitUntil: 'networkidle' })
    await buyerPage.getByRole('heading', { name: /Repita seu pedido anterior/i }).waitFor()
    await buyerPage.getByRole('button', { name: /Enviar pedido para análise/i }).click()
    await buyerPage.getByRole('heading', { name: /Pedido enviado para análise/i }).waitFor()
    console.log('  PASS recompra submetida')
    await buyerPage.screenshot({ path: join(OUT, 'recompra-sucesso.png'), fullPage: true })

    if (errors.length > 0) {
      throw new Error(`Erros de runtime:\n${errors.join('\n')}`)
    }

    console.log(`\nPASS smoke de produção (${APP_URL})`)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/im', 'chrome.exe', '/f'], { stdio: 'ignore' })
  }
  process.exit(1)
})
