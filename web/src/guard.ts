/** Casual hardening — not DRM. Browsers can always capture pixels. */

export function installGuards() {
  document.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault()
    },
    { capture: true },
  )
  document.addEventListener(
    'dragstart',
    (e) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO')) e.preventDefault()
    },
    { capture: true },
  )
  document.addEventListener(
    'keydown',
    (e) => {
      const key = e.key.toLowerCase()
      if (e.ctrlKey && e.shiftKey && (key === 'i' || key === 'j' || key === 'c' || key === 'k')) {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.ctrlKey && (key === 'u' || key === 's' || key === 'p')) {
        e.preventDefault()
        e.stopPropagation()
      }
      if (key === 'f12' || key === 'printscreen') {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    { capture: true },
  )

  // Mute console fingerprints outside local Vite
  try {
    const isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)
    if (!isDev) {
      const noop = () => {}
      for (const k of ['log', 'debug', 'info', 'warn', 'error', 'table', 'dir'] as const) {
        // eslint-disable-next-line no-console
        console[k] = noop
      }
    }
  } catch {
    /* ignore */
  }

  const style = document.createElement('style')
  style.textContent =
    'img,video{user-select:none;-webkit-user-drag:none;pointer-events:none}#app img,#app video{pointer-events:none}'
  document.head.appendChild(style)
}
