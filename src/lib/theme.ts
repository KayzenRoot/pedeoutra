export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'pedeoutra-theme'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

export function readThemePreference(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function writeThemePreference(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  preference: ThemePreference,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Armazenamento indisponível (modo privado): mantém apenas a sessão.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function applyTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
  prefersDark: boolean = systemPrefersDark(),
): ResolvedTheme {
  const resolved = resolveTheme(preference, prefersDark)
  root.dataset.theme = resolved
  root.dataset.themePreference = preference
  root.style.colorScheme = resolved
  return resolved
}

export function watchSystemTheme(
  preference: ThemePreference,
  onChange: (resolved: ResolvedTheme) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = () => {
    if (preference === 'system') onChange(resolveTheme('system', media.matches))
  }
  media.addEventListener?.('change', listener)
  return () => media.removeEventListener?.('change', listener)
}
