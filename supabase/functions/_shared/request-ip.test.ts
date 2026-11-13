import { describe, expect, it } from 'vitest'
import { clientIpFromHeaders } from './request-ip.ts'

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('IP de cliente', () => {
  it('prioriza cf-connecting-ip da borda', () => {
    expect(
      clientIpFromHeaders(
        headers({
          'cf-connecting-ip': '203.0.113.10',
          'x-real-ip': '198.51.100.20',
          'x-forwarded-for': '192.0.2.30, 10.0.0.1',
        }),
      ),
    ).toBe('203.0.113.10')
  })

  it('usa x-real-ip quando não há Cloudflare', () => {
    expect(
      clientIpFromHeaders(
        headers({
          'x-real-ip': '198.51.100.20',
          'x-forwarded-for': '192.0.2.30',
        }),
      ),
    ).toBe('198.51.100.20')
  })

  it('usa o último X-Forwarded-For como fallback', () => {
    expect(
      clientIpFromHeaders(headers({ 'x-forwarded-for': '192.0.2.30, 10.0.0.1' })),
    ).toBe('10.0.0.1')
  })

  it('ignora header vazio e retorna unknown', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': ' , ' }))).toBe('unknown')
    expect(clientIpFromHeaders(new Headers())).toBe('unknown')
  })
})
