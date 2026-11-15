/** Casual hardening — not DRM. Browsers can always capture pixels. */

export function installGuards() {
  document.addEventListener(
    'contextmenu',
    (e) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO' || t.closest('.tile, .tear, .jumpscare'))) {
        e.preventDefault()
      }
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
  const style = document.createElement('style')
  style.textContent = 'img,video{user-select:none;-webkit-user-drag:none}'
  document.head.appendChild(style)
}
