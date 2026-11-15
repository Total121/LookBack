/**
 * Hold-click drag for collage tiles.
 * Pulls photo/video tiles free of their strip so they stay where dropped.
 */

const DRAG_THRESHOLD = 7
let freeLayer: HTMLElement | null = null
let zTop = 40

function ensureFreeLayer(chaos: HTMLElement): HTMLElement {
  if (freeLayer && freeLayer.isConnected) return freeLayer
  let layer = chaos.querySelector<HTMLElement>('.chaos-free')
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'chaos-free'
    chaos.appendChild(layer)
  }
  freeLayer = layer
  return layer
}

export function resetDragLayer() {
  freeLayer = null
  zTop = 40
}

export type TileDragOpts = {
  /** Fired once when the tile leaves its strip into the free layer. */
  onFreed?: (tile: HTMLElement) => void
}

/**
 * Make a photo/video tile draggable. Call once per tile after creation.
 * Click-to-open still works unless the pointer moved past the drag threshold.
 */
export function enableTileDrag(tile: HTMLElement, opts: TileDragOpts = {}) {
  if (tile.dataset.dragBound === '1') return
  tile.dataset.dragBound = '1'
  tile.classList.add('draggable')

  let pointerId = -1
  let startX = 0
  let startY = 0
  let offsetX = 0
  let offsetY = 0
  let active = false
  let dragged = false
  let freed = false
  let chaos: HTMLElement | null = null

  const suppressClick = (e: Event) => {
    if (!dragged) return
    e.stopImmediatePropagation()
    e.preventDefault()
    dragged = false
  }
  tile.addEventListener('click', suppressClick, true)

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    if (!active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      active = true
      dragged = true
      beginDrag(e)
    }

    if (!chaos) return
    e.preventDefault()
    const chaosRect = chaos.getBoundingClientRect()
    tile.style.left = `${e.clientX - chaosRect.left - offsetX}px`
    tile.style.top = `${e.clientY - chaosRect.top - offsetY}px`
  }

  const endDrag = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    pointerId = -1
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
    try {
      tile.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    tile.classList.remove('dragging')
    document.body.classList.remove('is-dragging-tile')
    if (active) {
      zTop += 1
      tile.style.zIndex = String(zTop)
      tile.classList.add('dragged')
      dragged = true
      window.setTimeout(() => {
        dragged = false
      }, 40)
    }
    active = false
  }

  const beginDrag = (e: PointerEvent) => {
    const host = document.getElementById('chaos')
    if (!host) return
    chaos = host
    const layer = ensureFreeLayer(host)
    const rect = tile.getBoundingClientRect()
    const chaosRect = host.getBoundingClientRect()
    offsetX = e.clientX - rect.left
    offsetY = e.clientY - rect.top

    const rot = tile.style.getPropertyValue('--r') || '0deg'
    tile.style.width = `${rect.width}px`
    tile.style.height = `${rect.height}px`
    tile.style.left = `${rect.left - chaosRect.left}px`
    tile.style.top = `${rect.top - chaosRect.top}px`
    tile.style.right = 'auto'
    tile.style.bottom = 'auto'
    tile.style.transform = `rotate(${rot})`
    tile.style.zIndex = String(zTop + 20)
    tile.classList.add('dragging', 'dragged')
    document.body.classList.add('is-dragging-tile')

    if (tile.parentElement !== layer) {
      layer.appendChild(tile)
      if (!freed) {
        freed = true
        opts.onFreed?.(tile)
      }
    }
  }

  tile.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, a, input, textarea')) return
    if (document.querySelector('.tear, .jumpscare, .upload-modal, .webcam-ask, .webcam-possess, .dread-blackout')) {
      return
    }
    pointerId = e.pointerId
    startX = e.clientX
    startY = e.clientY
    active = false
    dragged = false
    try {
      tile.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  })
}
