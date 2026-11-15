/**
 * Progressive dread — the longer you stay, the worse it gets.
 * Caps at a 10-hour blackout ending.
 */

import { jumpscare, maybeAmbientSting, play, playSnippet, CUSTOM_SFX, stopAllHauntAudio } from './audio/haunt'
import { bootFaces } from './boot'

const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000
const ENDING_MS = 10 * HOUR

let startedAt = 0
let timer: number | null = null
let endingDone = false
let lastGlitch = 0
let lastShake = 0
let lastFlash = 0
let intensityMul = 1
let ambientOn = true

export function setDreadMultiplier(n: number) {
  intensityMul = Math.min(2, Math.max(0.25, n || 1))
}

export function setAmbientEnabled(v: boolean) {
  ambientOn = Boolean(v)
}

export function sessionAgeMs() {
  return startedAt ? Date.now() - startedAt : 0
}

/** 0..1 based on time on site (hits ~1 around 10h). */
export function dreadIntensity() {
  const age = sessionAgeMs()
  const base = Math.min(1, Math.pow(age / ENDING_MS, 0.55))
  return Math.min(1, base * intensityMul)
}

function tier(): 0 | 1 | 2 | 3 | 4 {
  const m = sessionAgeMs() / MIN
  if (m >= 10 * 60) return 4 // 10h
  if (m >= 45) return 3
  if (m >= 10) return 2
  if (m >= 3) return 1
  return 0
}

function ensureLayer() {
  let layer = document.querySelector<HTMLElement>('.dread-layer')
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'dread-layer'
    layer.setAttribute('aria-hidden', 'true')
    document.body.appendChild(layer)
  }
  return layer
}

function flashTv() {
  const now = Date.now()
  if (now - lastFlash < 900) return
  lastFlash = now
  const el = document.createElement('div')
  el.className = 'dread-tv-flash'
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 180 + Math.random() * 220)
}

function glitchBurst(hard = false) {
  const now = Date.now()
  if (now - lastGlitch < (hard ? 600 : 1400)) return
  lastGlitch = now
  document.documentElement.classList.add(hard ? 'dread-glitch-hard' : 'dread-glitch')
  setTimeout(() => {
    document.documentElement.classList.remove('dread-glitch', 'dread-glitch-hard')
  }, hard ? 420 : 220)
  if (hard || Math.random() > 0.5) flashTv()
}

function shakeSite(hard = false) {
  const now = Date.now()
  if (now - lastShake < 1200) return
  lastShake = now
  document.body.classList.add(hard ? 'shake-hard' : 'dread-shake')
  setTimeout(() => {
    document.body.classList.remove('shake-hard', 'dread-shake')
  }, hard ? 700 : 450)
}

function whisperOverlay() {
  const el = document.createElement('div')
  el.className = 'dread-whisper'
  el.textContent = pick([
    'behind you',
    'stop scrolling',
    'she sees you',
    'do not look up',
    'still watching',
    'leave',
    'look back',
  ])
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 900 + Math.random() * 900)
}

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function tick() {
  if (endingDone) return
  const age = sessionAgeMs()
  if (age >= ENDING_MS) {
    runTenHourEnding()
    return
  }

  const t = tier()
  const intensity = dreadIntensity()
  const layer = ensureLayer()
  layer.dataset.tier = String(t)
  layer.style.setProperty('--dread', String(intensity))

  // Random ambient (sparse → denser with time)
  if (ambientOn && t >= 1) maybeAmbientSting(intensity)

  // Random visual corruption
  const glitchChance = 0.04 + t * 0.06 + intensity * 0.08
  if (Math.random() < glitchChance) glitchBurst(t >= 3)

  if (t >= 1 && Math.random() < 0.03 + intensity * 0.05) shakeSite(t >= 3)
  if (t >= 2 && Math.random() < 0.025 + intensity * 0.04) {
    whisperOverlay()
    void playSnippet(CUSTOM_SFX.ghost, 0.22 + intensity * 0.2, 2)
  }
  if (t >= 2 && Math.random() < 0.02) flashTv()
  if (t >= 3 && Math.random() < 0.015 + intensity * 0.03) {
    jumpscare({ brutality: 0.65 + intensity * 0.35 })
  }
  if (t >= 2 && Math.random() < 0.012) {
    void playSnippet(CUSTOM_SFX.laugh, 0.2 + intensity * 0.25, 2.4)
  }
  if (t >= 1 && Math.random() < 0.01) {
    void playSnippet(CUSTOM_SFX.watching, 0.18 + intensity * 0.2, 3.5)
  }
}

function runTenHourEnding() {
  if (endingDone) return
  endingDone = true
  if (timer != null) {
    window.clearInterval(timer)
    timer = null
  }

  stopAllHauntAudio()
  document.body.classList.add('dread-ending')
  document.documentElement.classList.add('dread-ending')
  // Freeze scroll
  const scrollY = window.scrollY
  window.scrollTo(0, scrollY)
  const block = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    window.scrollTo(0, scrollY)
  }
  window.addEventListener('wheel', block, { passive: false, capture: true })
  window.addEventListener('touchmove', block, { passive: false, capture: true })
  window.addEventListener('scroll', block, { passive: false, capture: true })
  document.addEventListener('keydown', block, { capture: true })

  const veil = document.createElement('div')
  veil.className = 'dread-blackout'
  const msg = document.createElement('div')
  msg.className = 'dread-blackout-msg'
  msg.textContent = 'i am behind you'
  veil.appendChild(msg)
  document.body.appendChild(veil)

  void play(CUSTOM_SFX.scream, 1)
  setTimeout(() => void playSnippet(CUSTOM_SFX.laugh, 0.85, 4), 200)
  setTimeout(() => void playSnippet(CUSTOM_SFX.watching, 0.7, 6), 500)
  setTimeout(() => void playSnippet(CUSTOM_SFX.ghost, 0.8, 5), 900)

  setTimeout(() => {
    msg.textContent = 'DO NOT TURN AROUND'
    jumpscare({ brutality: 1, force: true })
  }, 2800)

  setTimeout(() => {
    msg.textContent = 'LOOK BACK'
    document.body.classList.add('shake-hard')
    glitchBurst(true)
    flashTv()
    void play(CUSTOM_SFX.scream, 1)
  }, 5200)

  setTimeout(() => {
    const faces = bootFaces()
    if (!faces.length) {
      jumpscare({ brutality: 1, force: true })
      return
    }
    let i = 0
    const face = document.createElement('img')
    face.className = 'dread-final-face'
    face.src = faces[0]
    face.alt = ''
    veil.appendChild(face)
    const cycle = window.setInterval(() => {
      i = (i + 1) % faces.length
      face.src = faces[i]
      face.classList.remove('dread-final-face')
      void face.offsetWidth
      face.classList.add('dread-final-face')
    }, 420)
    jumpscare({ brutality: 1, force: true })
    window.setTimeout(() => clearInterval(cycle), 5000)
  }, 7000)
}

export function startDread() {
  if (startedAt) return
  startedAt = Date.now()
  endingDone = false
  ensureLayer()
  timer = window.setInterval(tick, 2800)
  // first quiet beat after a short delay
  window.setTimeout(() => maybeAmbientSting(0.05), 12000)
}

export function stopDread() {
  if (timer != null) window.clearInterval(timer)
  timer = null
  startedAt = 0
  document.querySelectorAll('.dread-layer, .dread-blackout, .dread-whisper, .dread-tv-flash').forEach((el) => el.remove())
  document.body.classList.remove('dread-ending', 'shake-hard', 'dread-shake')
  document.documentElement.classList.remove('dread-ending', 'dread-glitch', 'dread-glitch-hard')
}

/** Hook from scroll — rare extra corruption while browsing. */
export function onDreadScroll() {
  if (!startedAt || endingDone) return
  const t = tier()
  if (t < 1) return
  if (Math.random() < 0.008 + dreadIntensity() * 0.02) glitchBurst(t >= 3)
  if (t >= 2 && Math.random() < 0.004) maybeAmbientSting(dreadIntensity())
}
