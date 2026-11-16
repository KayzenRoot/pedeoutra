import { describe, expect, it } from 'vitest'
import {
  catalogQrUrl,
  createCatalogQrSvg,
  qrSvgDataUri,
} from './qr'

describe('QR do catálogo', () => {
  it('gera a URL canônica do catálogo', () => {
    expect(catalogQrUrl('distribuidora-teste', 'https://app.pedeoutra.test')).toBe(
      'https://app.pedeoutra.test/c/distribuidora-teste',
    )
  })

  it('rejeita slug inválido e HTTP fora de localhost', () => {
    expect(() => catalogQrUrl('../admin', 'https://app.test')).toThrow(/Slug/)
    expect(() => catalogQrUrl('ok', 'http://app.test')).toThrow(/HTTPS/)
    expect(catalogQrUrl('ok', 'http://localhost:5173')).toContain('/c/ok')
  })

  it('gera SVG preto/branco sem chamadas externas', () => {
    const svg = createCatalogQrSvg(
      'https://app.pedeoutra.test/c/distribuidora-teste',
      256,
    )
    expect(svg).toContain('<svg')
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('fill="#000000"')
    expect(svg).not.toContain('https://')
    expect(svg).not.toContain('href=')
  })

  it('embute o SVG em data URI', () => {
    const svg = createCatalogQrSvg('https://app.test/c/loja', 128)
    const uri = qrSvgDataUri(svg)
    expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(uri.split(',')[1])).toBe(svg)
  })
})
