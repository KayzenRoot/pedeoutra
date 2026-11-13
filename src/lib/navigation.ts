/**
 * Aceita apenas caminhos internos absolutos. Bloqueia protocol-relative
 * (`//host`) e variações com barra invertida (`/\host`) usadas em open redirect.
 */
export function safeInternalPath(value: string | null | undefined, fallback = '/app'): string {
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (/\\|%5c|%2f/i.test(value)) return fallback

  try {
    const parsed = new URL(value, 'https://internal.invalid')
    if (parsed.origin !== 'https://internal.invalid') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
