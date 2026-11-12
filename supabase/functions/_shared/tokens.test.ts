import { describe, expect, it } from 'vitest'
import {
  REORDER_TOKEN_BYTES,
  constantTimeEqual,
  generateReorderToken,
  isValidReorderToken,
  sha256Hex,
} from './tokens.ts'

describe('tokens de recompra', () => {
  it('gera 32 bytes em base64url (43 caracteres)', () => {
    const token = generateReorderToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(isValidReorderToken(token)).toBe(true)

    const decoded = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    expect(decoded).toHaveLength(REORDER_TOKEN_BYTES)
  })

  it('não repete tokens em 200 gerações', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateReorderToken()))
    expect(tokens.size).toBe(200)
  })

  it('rejeita formatos inválidos', () => {
    expect(isValidReorderToken('')).toBe(false)
    expect(isValidReorderToken('curto')).toBe(false)
    expect(isValidReorderToken('a'.repeat(42))).toBe(false)
    expect(isValidReorderToken('a'.repeat(44))).toBe(false)
    expect(isValidReorderToken('!'.repeat(43))).toBe(false)
    expect(isValidReorderToken(null)).toBe(false)
  })

  it('hash SHA-256 é estável, hex e não reversível ao token', async () => {
    const token = generateReorderToken()
    const first = await sha256Hex(token)
    const second = await sha256Hex(token)
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(first).not.toContain(token)
  })

  it('compara tokens em tempo constante', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'ab')).toBe(false)
  })
})
