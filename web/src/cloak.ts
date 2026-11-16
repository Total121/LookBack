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

/** Paint immediately via opaque token, then quietly swap to blob when idle. */
export function bindOpaqueImg(
  img: HTMLImageElement,
  src: string,
  opts: { priority?: 'high' | 'low' | 'auto'; lazy?: boolean } = {},
) {
  img.dataset.mediaSrc = src
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
  img.src = src

  const cloak = () => {
    if (!img.isConnected || img.dataset.cloaked === '1') return
    const run = () => {
      void toBlobUrl(src).then((url) => {
        if (!img.isConnected || url === src) return
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
