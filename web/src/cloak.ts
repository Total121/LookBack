/**
 * Cloak media URLs as short-lived blob: URLs so Elements/F12 shows blob:… not /m/<token>.
 * Network still fetches once (unavoidable to display pixels); DOM references stay opaque.
 */

const cache = new Map<string, { url: string; refs: number }>()

export async function cloakUrl(src: string): Promise<string> {
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return src
  const hit = cache.get(src)
  if (hit) {
    hit.refs++
    return hit.url
  }
  try {
    const res = await fetch(src, { cache: 'force-cache' })
    if (!res.ok) return src
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    cache.set(src, { url, refs: 1 })
    return url
  } catch {
    return src
  }
}

export function releaseCloak(src: string) {
  const hit = cache.get(src)
  if (!hit) return
  hit.refs--
  if (hit.refs <= 0) {
    try {
      URL.revokeObjectURL(hit.url)
    } catch {
      /* ignore */
    }
    cache.delete(src)
  }
}

export function clearCloakCache() {
  for (const hit of cache.values()) {
    try {
      URL.revokeObjectURL(hit.url)
    } catch {
      /* ignore */
    }
  }
  cache.clear()
}
