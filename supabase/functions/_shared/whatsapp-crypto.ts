const KEY_BYTES = 32
const IV_BYTES = 12

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCodePoint(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0
  }
  return bytes
}

export function parseEncryptionKey(value: string | undefined | null): Uint8Array | null {
  if (!value) return null
  try {
    const bytes = base64ToBytes(value.trim())
    return bytes.length === KEY_BYTES ? bytes : null
  } catch {
    return null
  }
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Retorna iv+ciphertext+tag em base64; nunca registra o segredo. */
export async function encryptSecret(
  plaintext: string,
  keyBytes: Uint8Array,
): Promise<string> {
  if (!plaintext.trim()) throw new Error('empty_secret')
  const key = await importKey(keyBytes)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(new TextEncoder().encode(plaintext)),
    ),
  )
  const combined = new Uint8Array(iv.length + encrypted.length)
  combined.set(iv)
  combined.set(encrypted, iv.length)
  return bytesToBase64(combined)
}

export async function decryptSecret(
  ciphertext: string,
  keyBytes: Uint8Array,
): Promise<string> {
  const combined = base64ToBytes(ciphertext)
  if (combined.length <= IV_BYTES) throw new Error('invalid_ciphertext')
  const iv = combined.slice(0, IV_BYTES)
  const encrypted = combined.slice(IV_BYTES)
  const key = await importKey(keyBytes)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encrypted),
  )
  return new TextDecoder().decode(decrypted)
}
