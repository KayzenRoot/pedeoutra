import { describe, expect, it } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from './theme'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('tema', () => {
  it('aceita somente light, dark e system', () => {
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })

  it('resolve system pela preferência do SO', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('lê e grava a preferência com fallback seguro', () => {
    const storage = memoryStorage()
    expect(readThemePreference(storage)).toBe('system')
    writeThemePreference(storage, 'dark')
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(readThemePreference(storage)).toBe('dark')
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: 'invalido' }))).toBe(
      'system',
    )
  })

  it('aplica data-theme, data-theme-preference e color-scheme', () => {
    const root = document.documentElement
    applyTheme('dark', root, false)
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.themePreference).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')

    applyTheme('system', root, true)
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.themePreference).toBe('system')

    applyTheme('light', root, true)
    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')
  })
})
