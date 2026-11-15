/**
 * Infinite media pool.
 * Walks every asset once (shuffled), then reshuffles and starts again —
 * more items = longer before a full loop; never dead-ends the scroll.
 */

export class MediaPool<T extends { src: string; featured?: boolean }> {
  private items: T[] = []
  private order: T[] = []
  private cursor = 0
  private laps = 0

  reset(items: T[]) {
    this.items = items.slice()
    this.laps = 0
    this.buildOrder()
  }

  private buildOrder() {
    const featured = this.items.filter((i) => i.featured)
    const rest = this.items.filter((i) => !i.featured)
    shuffleInPlace(featured)
    shuffleInPlace(rest)

    // First lap: accepted/community first so new uploads show up while scrolling,
    // then the rest. Later laps fully reshuffle everything together.
    if (this.laps === 0 && featured.length) {
      this.order = featured.concat(rest)
    } else {
      this.order = featured.concat(rest)
      shuffleInPlace(this.order)
    }
    this.cursor = 0
  }

  /** Next item forever — when the list ends, begin from the start again. */
  next(): T | null {
    if (!this.items.length) return null
    if (this.cursor >= this.order.length) {
      this.laps++
      this.buildOrder()
    }
    const item = this.order[this.cursor]
    this.cursor++
    return item
  }

  size() {
    return this.items.length
  }

  lap() {
    return this.laps
  }
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
