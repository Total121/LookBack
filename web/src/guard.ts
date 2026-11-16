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
      if (e.ctrlKey && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.ctrlKey && (key === 'u' || key === 's')) {
        e.preventDefault()
        e.stopPropagation()
      }
      if (key === 'f12') {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    { capture: true },
  )
  const style = document.createElement('style')
  style.textContent =
    'img,video{user-select:none;-webkit-user-drag:none;pointer-events:none}#app img,#app video{pointer-events:none}'
  document.head.appendChild(style)
}
