/**
 * Optional post-load cloak: after pixels are on screen, swap <img src="/m/…">
 * to a blob: URL so Elements shows blob:… instead of the token.
 * Never blocks first paint — tokens already hide vault paths.
 */

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

async function toBlobUrl(src: string): Promise<string> {
  const hit = cache.get(src)
  if (hit) return hit
  const inflight = pending.get(src)
  if (inflight) return inflight
  const job = (async () => {
    try {
      const res = await fetch(src, { cache: 'force-cache', credentials: 'same-origin' })
      if (!res.ok) return src
      const blob = await res.blob()
      if (!blob.size) return src
      const url = URL.createObjectURL(blob)
      cache.set(src, url)
      return url
    } catch {
      return src
    } finally {
      pending.delete(src)
    }
  })()
  pending.set(src, job)
  return job
}

/**
 * Paint immediately via opaque token.
 * Optional fallbackSrc used if primary fails (e.g. thumb → full).
 * Cloak is off by default — blob swapping caused blank tiles under load.
 */
export function bindOpaqueImg(
  img: HTMLImageElement,
  src: string,
  opts: {
    priority?: 'high' | 'low' | 'auto'
    lazy?: boolean
    fallbackSrc?: string
    /** Rarely useful; keep false for feed tiles. */
    cloak?: boolean
  } = {},
) {
  const primary = src
  const fallback = opts.fallbackSrc && opts.fallbackSrc !== src ? opts.fallbackSrc : ''
  img.dataset.mediaSrc = primary
  if (fallback) img.dataset.fallbackSrc = fallback
  img.alt = ''
  img.decoding = 'async'
  if (opts.lazy !== false) img.loading = 'lazy'
  else img.loading = 'eager'
  if (opts.priority) {
    try {
      ;(img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = opts.priority
    } catch {
      /* ignore */
    }
  }

  img.onerror = () => {
    const next = img.dataset.fallbackSrc
    if (next && img.src !== next && !img.src.endsWith(next)) {
      delete img.dataset.fallbackSrc
      img.dataset.mediaSrc = next
      img.src = next
      return
    }
    img.onerror = null
  }

  img.src = primary

  if (opts.cloak !== true) return

  const cloak = () => {
    if (!img.isConnected || img.dataset.cloaked === '1') return
    const run = () => {
      void toBlobUrl(img.dataset.mediaSrc || primary).then((url) => {
        if (!img.isConnected || url === (img.dataset.mediaSrc || primary)) return
        img.dataset.cloaked = '1'
        img.src = url
      })
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2500 })
    else setTimeout(run, 400)
  }

  if (img.complete && img.naturalWidth) cloak()
  else img.addEventListener('load', cloak, { once: true })
}

export function clearCloakCache() {
  for (const url of cache.values()) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
  cache.clear()
  pending.clear()
}
