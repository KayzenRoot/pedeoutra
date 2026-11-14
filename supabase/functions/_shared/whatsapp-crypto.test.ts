import { describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
} from './whatsapp-crypto'

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))
const KEY_BASE64 = btoa(String.fromCharCode(...KEY))

describe('criptografia de token WhatsApp', () => {
  it('cifra e decifra com AES-GCM e IV aleatório', async () => {
    const first = await encryptSecret('EAAG-token-super-secreto', KEY)
    const second = await encryptSecret('EAAG-token-super-secreto', KEY)
    expect(first).not.toBe(second)
    expect(first).not.toContain('super-secreto')
    expect(await decryptSecret(first, KEY)).toBe('EAAG-token-super-secreto')
    expect(await decryptSecret(second, KEY)).toBe('EAAG-token-super-secreto')
  })

  it('rejeita chave, ciphertext e segredo inválidos', async () => {
    expect(parseEncryptionKey(undefined)).toBeNull()
    expect(parseEncryptionKey('curta')).toBeNull()
    expect(parseEncryptionKey(KEY_BASE64)).toHaveLength(32)
    await expect(encryptSecret('   ', KEY)).rejects.toThrow('empty_secret')
    await expect(decryptSecret('AAAA', KEY)).rejects.toThrow('invalid_ciphertext')
    await expect(decryptSecret('AAAA'.repeat(10), KEY)).rejects.toBeTruthy()
  })
})
