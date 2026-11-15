/** Media usage pool — each asset at most MAX times in the live scroll. */

const MAX = 5

export class MediaPool<T extends { src: string }> {
  private items: T[] = []
  private used = new Map<string, number>()
  private cursor = 0

  reset(items: T[]) {
    this.items = items.slice()
    // shuffle
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[this.items[i], this.items[j]] = [this.items[j], this.items[i]]
    }
    this.used.clear()
    this.cursor = 0
  }

  /** Next item under the repeat cap, or null if all exhausted at MAX. */
  next(): T | null {
    if (!this.items.length) return null
    const n = this.items.length
    for (let tries = 0; tries < n; tries++) {
      const item = this.items[this.cursor % n]
      this.cursor++
      const c = this.used.get(item.src) || 0
      if (c < MAX) {
        this.used.set(item.src, c + 1)
        return item
      }
    }
    // all at cap — soft reset counts so infinite scroll can continue, but
    // never burst the same src more than MAX within a window
    this.used.clear()
    const item = this.items[this.cursor % n]
    this.cursor++
    this.used.set(item.src, 1)
    return item
  }

  size() {
    return this.items.length
  }
}
