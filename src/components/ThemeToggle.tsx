import { useEffect, useState } from 'react'
import {
  applyTheme,
  readThemePreference,
  watchSystemTheme,
  writeThemePreference,
  type ThemePreference,
} from '../lib/theme'

const OPTIONS: Array<{ value: ThemePreference; label: string; short: string }> = [
  { value: 'light', label: 'Tema claro', short: 'Claro' },
  { value: 'dark', label: 'Tema escuro', short: 'Escuro' },
  { value: 'system', label: 'Tema do sistema', short: 'Sistema' },
]

export function ThemeToggle({ compact = false }: { readonly compact?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readThemePreference(typeof window === 'undefined' ? null : window.localStorage),
  )

  useEffect(() => {
    applyTheme(preference)
    return watchSystemTheme(preference, () => applyTheme(preference))
  }, [preference])

  function choose(next: ThemePreference) {
    setPreference(next)
    writeThemePreference(window.localStorage, next)
    applyTheme(next)
  }

  return (
    <fieldset
      className={compact ? 'theme-toggle theme-toggle-compact' : 'theme-toggle'}
    >
      <legend className="sr-only">Preferência de tema</legend>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="theme-option"
          aria-pressed={preference === option.value}
          title={option.label}
          onClick={() => choose(option.value)}
        >
          {compact ? option.short[0] : option.short}
        </button>
      ))}
    </fieldset>
  )
}
