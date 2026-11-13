/* eslint-disable no-undef */
/* Resolve o tema antes do primeiro paint. Mantido externo por causa da CSP. */
;(function () {
  try {
    var key = 'pedeoutra-theme'
    var preference = window.localStorage.getItem(key)
    if (preference !== 'light' && preference !== 'dark' && preference !== 'system') {
      preference = 'system'
    }
    var prefersDark =
      window.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true
    var resolved = preference
    if (preference === 'system') {
      resolved = prefersDark ? 'dark' : 'light'
    }
    var root = document.documentElement
    root.dataset.theme = resolved
    root.dataset.themePreference = preference
    root.style.colorScheme = resolved
  } catch {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.dataset.themePreference = 'system'
  }
})()
