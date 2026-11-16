import { describe, expect, it } from 'vitest'
import {
  detectImageMime,
  extensionForMime,
  validateAltText,
  validateImageBytes,
} from './image.ts'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

describe('validação de imagem', () => {
  it('detecta JPEG, PNG e WebP pelos magic bytes', () => {
    expect(detectImageMime(JPEG)).toBe('image/jpeg')
    expect(detectImageMime(PNG)).toBe('image/png')
    expect(detectImageMime(WEBP)).toBe('image/webp')
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('image/png')).toBe('png')
    expect(extensionForMime('image/webp')).toBe('webp')
  })

  it('rejeita SVG, HTML e arquivo vazio', () => {
    expect(detectImageMime(new TextEncoder().encode('<svg></svg>'))).toBeNull()
    expect(detectImageMime(new TextEncoder().encode('<html></html>'))).toBeNull()
    expect(validateImageBytes(new Uint8Array(), 'image/png')).toEqual({
      ok: false,
      reason: 'empty',
    })
  })

  it('rejeita MIME declarado diferente do conteúdo real', () => {
    expect(validateImageBytes(PNG, 'image/jpeg')).toEqual({
      ok: false,
      reason: 'mime_mismatch',
    })
    expect(validateImageBytes(JPEG, 'image/svg+xml')).toEqual({
      ok: false,
      reason: 'unsupported_type',
    })
  })

  it('respeita o limite de tamanho', () => {
    expect(validateImageBytes(JPEG, 'image/jpeg', 3)).toEqual({
      ok: false,
      reason: 'too_large',
    })
  })

  it('exige texto alternativo entre 3 e 160 caracteres', () => {
    expect(validateAltText('Copo')).toBe('Copo')
    expect(validateAltText('  Copo de água  ')).toBe('Copo de água')
    expect(validateAltText('ab')).toBeNull()
    expect(validateAltText('')).toBeNull()
    expect(validateAltText('x'.repeat(161))).toBeNull()
  })
})
