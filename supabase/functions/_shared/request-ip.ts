/**
 * Extrai o IP de cliente com prioridade para headers definidos pela borda
 * confiável (Cloudflare/Supabase). X-Forwarded-For é usado apenas como fallback
 * e o último valor é o mais próximo do proxy, reduzindo spoofing trivial.
 *
 * Em self-hosting, configure a borda para sobrescrever estes headers.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const cloudflare = headers.get('cf-connecting-ip')?.trim()
  if (cloudflare) return cloudflare

  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const closest = parts[parts.length - 1]
    if (closest) return closest
  }

  return 'unknown'
}
