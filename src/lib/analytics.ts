const ENDPOINT = (import.meta.env.VITE_ANALYTICS_ENDPOINT as string | undefined)?.trim()

function safePath(): string {
  const path = window.location.pathname
  if (path.startsWith('/r/')) return '/r/:token'
  return path
}

/**
 * Analytics sem PII: só nome do evento e rota saneada.
 * Tokens de recompra nunca são enviados; query strings são ignoradas.
 */
export function track(event: string): void {
  if (!ENDPOINT) return
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, path: safePath() }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // Analytics nunca quebra a aplicação.
  }
}
