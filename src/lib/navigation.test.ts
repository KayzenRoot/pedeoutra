import { describe, expect, it } from 'vitest'
import { safeInternalPath } from './navigation'

describe('safeInternalPath', () => {
  it('aceita caminhos internos', () => {
    expect(safeInternalPath('/app/pedidos?status=new#top')).toBe('/app/pedidos?status=new#top')
    expect(safeInternalPath('/onboarding')).toBe('/onboarding')
  })

  it('bloqueia hosts externos e variações de barra', () => {
    expect(safeInternalPath('https://evil.example')).toBe('/app')
    expect(safeInternalPath('//evil.example')).toBe('/app')
    expect(safeInternalPath('/\\evil.example')).toBe('/app')
    expect(safeInternalPath('/%5Cevil.example')).toBe('/app')
  })

  it('usa fallback para vazio', () => {
    expect(safeInternalPath(null)).toBe('/app')
    expect(safeInternalPath('')).toBe('/app')
  })
})
