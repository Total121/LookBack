/**
 * Deck pool — each asset appears at most MAX_SHOWS times per cycle.
 * Layered deal: every item is shown once before any gets a second show.
 * After all hit MAX_SHOWS, counts reset and the deck reshuffles (start over).
 * Scroll-up remounts use stored strip specs and do not re-draw from the pool.
 */

const MAX_SHOWS = 2

export class MediaPool<T extends { src: string; featured?: boolean }> {
  private items: T[] = []
  private bySrc = new Map<string, T>()
  private shows = new Map<string, number>()
  private queue: string[] = []
  private layer = 0
  private cycles = 0

  reset(items: T[]) {
    this.items = items.slice()
    this.bySrc = new Map(items.map((i) => [i.src, i]))
    this.shows = new Map(items.map((i) => [i.src, 0]))
    this.layer = 0
    this.cycles = 0
    this.refillQueue()
  }

  /** Build queue of srcs that still need a show at the current layer (0 then 1). */
  private refillQueue() {
    if (!this.items.length) {
      this.queue = []
      return
    }

    // If everyone already hit MAX_SHOWS, start a fresh cycle
    const allDone = this.items.every((i) => (this.shows.get(i.src) || 0) >= MAX_SHOWS)
    if (allDone) {
      for (const i of this.items) this.shows.set(i.src, 0)
      this.layer = 0
      this.cycles++
    }

    // Prefer filling lower layers first (unique pass, then optional 2nd pass)
    while (this.layer < MAX_SHOWS) {
      const need = this.items
        .filter((i) => (this.shows.get(i.src) || 0) === this.layer)
        .map((i) => i.src)
      if (need.length) {
        // First cycle: featured first on layer 0 only
        if (this.cycles === 0 && this.layer === 0) {
          const featured = need.filter((s) => this.bySrc.get(s)?.featured)
          const rest = need.filter((s) => !this.bySrc.get(s)?.featured)
          shuffleInPlace(featured)
          shuffleInPlace(rest)
          this.queue = featured.concat(rest)
        } else {
          shuffleInPlace(need)
          this.queue = need
        }
        return
      }
      this.layer++
    }

    // Fallback — should have reset above; rebuild once
    for (const i of this.items) this.shows.set(i.src, 0)
    this.layer = 0
    this.cycles++
    const all = this.items.map((i) => i.src)
    shuffleInPlace(all)
    this.queue = all
  }

  /** Next item for downward scroll. Never returns an item already at MAX_SHOWS this cycle. */
  next(): T | null {
    if (!this.items.length) return null
    if (!this.queue.length) this.refillQueue()
    if (!this.queue.length) return null

    const src = this.queue.shift()!
    const n = (this.shows.get(src) || 0) + 1
    this.shows.set(src, n)
    return this.bySrc.get(src) || null
  }

  size() {
    return this.items.length
  }

  lap() {
    return this.cycles
  }

  /** How many times this src has been dealt in the current cycle (0–MAX_SHOWS). */
  shownCount(src: string) {
    return this.shows.get(src) || 0
  }
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
