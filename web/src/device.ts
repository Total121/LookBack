/**
 * Capability heuristics — same collage look, lighter cost on phones / low-end.
 */

let cached: {
  constrained: boolean
  reduceMotion: boolean
  maxVideos: number
  cloakFeed: boolean
} | null = null

export function deviceProfile() {
  if (cached) return cached
  const coarse =
    typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 820)
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
  const lowMem =
    typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number' &&
    ((navigator as Navigator & { deviceMemory?: number }).deviceMemory as number) > 0 &&
    ((navigator as Navigator & { deviceMemory?: number }).deviceMemory as number) <= 4
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const constrained = coarse || saveData || lowMem
  cached = {
    constrained,
    reduceMotion,
    maxVideos: constrained ? 1 : 2,
    cloakFeed: !constrained && !saveData,
  }
  return cached
}

export function resetDeviceProfile() {
  cached = null
}
