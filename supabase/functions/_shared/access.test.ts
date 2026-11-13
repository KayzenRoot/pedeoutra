import { describe, expect, it } from 'vitest'
import { accessLabel, isWriteAllowed } from './access.ts'

const NOW = new Date('2026-11-12T12:00:00Z')

function input(overrides: Partial<Parameters<typeof isWriteAllowed>[0]> = {}) {
  return {
    trial_ends_at: '2026-11-20T12:00:00Z',
    access_state: 'trial',
    subscription: null,
    ...overrides,
  }
}

describe('acesso de escrita (espelho do SQL)', () => {
  it('trial vigente libera', () => {
    expect(isWriteAllowed(input(), NOW)).toBe(true)
    expect(accessLabel(input(), NOW)).toBe('trial')
  })

  it('trial expirado sem assinatura bloqueia', () => {
    expect(isWriteAllowed(input({ trial_ends_at: '2026-11-01T00:00:00Z' }), NOW)).toBe(false)
    expect(accessLabel(input({ trial_ends_at: '2026-11-01T00:00:00Z' }), NOW)).toBe('expired')
  })

  it('bloqueio manual vence trial', () => {
    expect(isWriteAllowed(input({ access_state: 'blocked' }), NOW)).toBe(false)
    expect(accessLabel(input({ access_state: 'blocked' }), NOW)).toBe('blocked')
  })

  it('assinatura ativa libera até o fim do período', () => {
    expect(
      isWriteAllowed(
        input({
          trial_ends_at: '2026-11-01T00:00:00Z',
          subscription: { state: 'active', current_period_end: '2026-12-01T00:00:00Z' },
        }),
        NOW,
      ),
    ).toBe(true)
    expect(
      isWriteAllowed(
        input({
          trial_ends_at: '2026-11-01T00:00:00Z',
          subscription: { state: 'active', current_period_end: '2026-11-01T00:00:00Z' },
        }),
        NOW,
      ),
    ).toBe(false)
  })

  it('past_due tem carência de 3 dias', () => {
    expect(
      isWriteAllowed(
        input({
          trial_ends_at: '2026-11-01T00:00:00Z',
          subscription: { state: 'past_due', current_period_end: '2026-11-10T12:00:00Z' },
        }),
        NOW,
      ),
    ).toBe(true)
    expect(
      isWriteAllowed(
        input({
          trial_ends_at: '2026-11-01T00:00:00Z',
          subscription: { state: 'past_due', current_period_end: '2026-11-08T12:00:00Z' },
        }),
        NOW,
      ),
    ).toBe(false)
  })

  it('cancelado mantém acesso até o fim do período', () => {
    expect(
      isWriteAllowed(
        input({
          trial_ends_at: '2026-11-01T00:00:00Z',
          subscription: { state: 'canceled', current_period_end: '2026-12-01T00:00:00Z' },
        }),
        NOW,
      ),
    ).toBe(true)
    expect(
      isWriteAllowed(
        input({
          trial_ends_at: '2026-11-01T00:00:00Z',
          subscription: { state: 'canceled', current_period_end: '2026-11-01T00:00:00Z' },
        }),
        NOW,
      ),
    ).toBe(false)
  })

  it('refunded, expired e pending não liberam', () => {
    for (const state of ['refunded', 'expired', 'pending']) {
      expect(
        isWriteAllowed(
          input({
            trial_ends_at: '2026-11-01T00:00:00Z',
            subscription: { state, current_period_end: '2026-12-01T00:00:00Z' },
          }),
          NOW,
        ),
      ).toBe(false)
    }
  })
})
