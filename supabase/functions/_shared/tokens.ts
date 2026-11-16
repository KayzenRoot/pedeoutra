/**
 * Tokens de recompra: 32 bytes de CSPRNG (256 bits), base64url.
 * Apenas o SHA-256 hex é persistido.
 */
export const REORDER_TOKEN_BYTES = 32
export const REORDER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
/** Mesmo formato opaco para links de preço por comprador. */
export const OPAQUE_TOKEN_PATTERN = REORDER_TOKEN_PATTERN

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function generateReorderToken(): string {
  const bytes = new Uint8Array(REORDER_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function isValidReorderToken(value: unknown): value is string {
  return typeof value === 'string' && REORDER_TOKEN_PATTERN.test(value)
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return diff === 0
}
