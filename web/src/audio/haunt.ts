/** Brutal haunt audio + jumpscares. Opaque /m/ tokens only — no vault paths. */

import { bootFaces, bootScarePool, bootSfx, getBoot, loadBoot } from '../boot'

let ac: AudioContext | null = null
let scareBusy = false
let lastScare = 0
let lastAmbient = 0
let activeSources: AudioBufferSourceNode[] = []
let imgWarm = false

const bufferCache = new Map<string, AudioBuffer>()
const inflight = new Map<string, Promise<AudioBuffer | null>>()

/** Runtime-resolved custom beds (from /api/boot). */
export const CUSTOM_SFX = {
  get laugh() {
    return bootSfx('laugh') || bootSfx('evil_laugh') || ''
  },
  get watching() {
    return bootSfx('watching') || bootSfx('shes_watching') || ''
  },
  get scream() {
    return bootSfx('scream') || bootSfx('loud_scream') || ''
  },
  get ghost() {
    return bootSfx('ghost') || bootSfx('ghost_voice') || ''
  },
}

function scareImgs() {
  const pool = bootScarePool()
  const faces = bootFaces()
  if (faces.length) return [...faces, ...faces, ...pool]
  return pool
}

function brutalFaces() {
  const faces = bootFaces()
  return faces.length ? faces : bootScarePool()
}

function sfx(...keys: string[]) {
  for (const k of keys) {
    const u = bootSfx(k)
    if (u) return u
  }
  return ''
}

function scarePool() {
  return [
    CUSTOM_SFX.scream,
    CUSTOM_SFX.laugh,
    sfx('scare'),
    sfx('scare2'),
    sfx('scare3'),
    sfx('scare4'),
    sfx('scare5'),
    sfx('scare6'),
    sfx('scare7'),
    sfx('scare9'),
    sfx('scare10'),
    sfx('scream'),
    sfx('scream2'),
    sfx('scream3'),
    sfx('scream_w'),
    sfx('death'),
  ].filter(Boolean)
}

function impactPool() {
  return [
    CUSTOM_SFX.scream,
    sfx('thunder'),
    sfx('glass'),
    sfx('blood'),
    sfx('chainsaw'),
    sfx('chains'),
    sfx('punch'),
  ].filter(Boolean)
}

function ambientPool() {
  return [
    CUSTOM_SFX.watching,
    CUSTOM_SFX.ghost,
    CUSTOM_SFX.laugh,
    sfx('whisper'),
    sfx('breath'),
    sfx('creak'),
    sfx('heartbeat'),
    sfx('static'),
    sfx('ghost2'),
  ].filter(Boolean)
}

const SCARE_WORDS = [
  'DIE',
  'WATCHING',
  'BEHIND',
  'NOW',
  'LOOK',
  'RUN',
  'SHHH',
  "DON'T",
  'STAY',
  'HELP',
  'I SEE YOU',
]

function ctx() {
  if (!ac) ac = new AudioContext()
  return ac
}

function pick<T>(arr: T[]) {
  if (!arr.length) return undefined as unknown as T
  return arr[Math.floor(Math.random() * arr.length)]
}

function warmScareImages() {
  if (imgWarm || typeof Image === 'undefined') return
  const imgs = scareImgs()
  if (!imgs.length) return
  imgWarm = true
  for (const src of [...new Set(imgs)]) {
    const im = new Image()
    im.decoding = 'async'
    im.src = src
  }
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  if (!url) return null
  const hit = bufferCache.get(url)
  if (hit) return hit
  const pending = inflight.get(url)
  if (pending) return pending
  const job = (async () => {
    try {
      const c = ctx()
      const res = await fetch(url, { cache: 'force-cache' })
      const buf = await c.decodeAudioData(await res.arrayBuffer())
      bufferCache.set(url, buf)
      return buf
    } catch {
      return null
    } finally {
      inflight.delete(url)
    }
  })()
  inflight.set(url, job)
  return job
}

export async function play(url: string, volume = 0.45, offset = 0, duration?: number) {
  if (!url) return null
  try {
    const c = ctx()
    if (c.state === 'suspended') await c.resume()
    const buf = await loadBuffer(url)
    if (!buf) return null
    const src = c.createBufferSource()
    const g = c.createGain()
    g.gain.value = volume
    src.buffer = buf
    src.connect(g)
    g.connect(c.destination)
    const startAt = Math.min(Math.max(0, offset), Math.max(0, buf.duration - 0.05))
    if (duration != null) src.start(0, startAt, duration)
    else src.start(0, startAt)
    activeSources.push(src)
    src.onended = () => {
      activeSources = activeSources.filter((s) => s !== src)
    }
    return src
  } catch {
    return null
  }
}

export async function playSnippet(url: string, volume = 0.28, maxLen = 2.8) {
  if (!url) return null
  const buf = await loadBuffer(url)
  if (!buf) return null
  const span = Math.min(maxLen, Math.max(0.6, buf.duration * 0.2))
  const maxStart = Math.max(0, buf.duration - span)
  const offset = Math.random() * maxStart
  return play(url, volume, offset, span)
}

export function stopAllHauntAudio() {
  for (const s of activeSources) {
    try {
      s.stop()
    } catch {
      /* ignore */
    }
  }
  activeSources = []
}

/** Unlock audio on ENTER — warm boot tokens + scare beds. */
export async function armHaunt() {
  await loadBoot()
  await ctx().resume()
  warmScareImages()
  void loadBuffer(sfx('creak'))
  void loadBuffer(sfx('heartbeat'))
  void loadBuffer(CUSTOM_SFX.scream)
  void loadBuffer(CUSTOM_SFX.laugh)
  void loadBuffer(CUSTOM_SFX.ghost)
  void loadBuffer(CUSTOM_SFX.watching)
}

export function maybeAmbientSting(intensity = 0) {
  const now = Date.now()
  const cooldown = Math.max(18000, 55000 - intensity * 25000)
  if (now - lastAmbient < cooldown) return
  if (Math.random() > 0.22 + intensity * 0.25) return
  lastAmbient = now
  const pool = ambientPool()
  if (!pool.length) return
  const url = pick(pool)
  const vol = 0.14 + intensity * 0.22 + Math.random() * 0.08
  if (url.includes('/m/')) void playSnippet(url, vol, 1.6 + intensity * 2.2)
  else void play(url, vol)
}

export type JumpscareOpts = {
  brutality?: number
  force?: boolean
}

type ScareMode = 'face' | 'behind' | 'static' | 'rush' | 'double' | 'close' | 'shush'

function pickMode(brutality: number): ScareMode {
  const roll = Math.random()
  if (brutality > 0.7) {
    if (roll < 0.22) return 'rush'
    if (roll < 0.4) return 'close'
    if (roll < 0.55) return 'double'
    if (roll < 0.68) return 'shush'
    if (roll < 0.82) return 'face'
    if (roll < 0.92) return 'behind'
    return 'static'
  }
  if (roll < 0.28) return 'face'
  if (roll < 0.48) return 'rush'
  if (roll < 0.62) return 'behind'
  if (roll < 0.76) return 'close'
  if (roll < 0.88) return 'double'
  return 'static'
}

function makeFullImg(src: string, cls = 'full') {
  const full = document.createElement('img')
  full.className = cls
  full.src = src
  full.alt = ''
  full.draggable = false
  return full
}

function makeTxt(extra = '') {
  const txt = document.createElement('div')
  txt.className = 'scare-txt' + (extra ? ' ' + extra : '')
  txt.textContent = pick(SCARE_WORDS)
  return txt
}

function buildScareDom(mode: ScareMode, brutality: number): HTMLElement {
  const el = document.createElement('div')
  el.className =
    'jumpscare mode-' +
    mode +
    (brutality > 0.55 ? ' brutal' : '') +
    (brutality > 0.85 ? ' ultra' : '')

  const faces = brutalFaces()
  const pool = scareImgs()
  const primary = brutality > 0.35 ? pick(faces) || pick(pool) : pick(pool) || pick(faces)
  const secondary = pick(faces) || primary
  if (!primary) {
    el.style.background = '#000'
    el.appendChild(makeTxt('scare-txt-slam'))
    return el
  }

  if (mode === 'behind') {
    const box = document.createElement('div')
    box.className = 'behind-scare'
    const sil = document.createElement('div')
    sil.className = 'you-silhouette'
    const entity = document.createElement('img')
    entity.className = 'entity'
    entity.src = Math.random() > 0.4 ? faces[1] || primary : primary
    entity.alt = ''
    const label = document.createElement('div')
    label.className = 'behind-label'
    label.textContent = pick([
      'IT IS BEHIND YOU',
      'DO NOT TURN AROUND',
      'SHE IS IN THE ROOM',
      'LOOK BACK',
      'SHHH…',
      'RIGHT BEHIND YOU',
    ])
    box.append(sil, entity, label)
    el.appendChild(box)
  } else if (mode === 'shush') {
    const full = makeFullImg(faces[1] || primary)
    const flash = document.createElement('div')
    flash.className = 'flash'
    const flash2 = document.createElement('div')
    flash2.className = 'flash flash-red'
    const hush = document.createElement('div')
    hush.className = 'scare-txt scare-shush'
    hush.textContent = pick(['SHHH', 'QUIET', "DON'T SCREAM", 'BE STILL'])
    const tear = document.createElement('div')
    tear.className = 'scare-tear'
    el.append(full, tear, flash, flash2, hush)
  } else if (mode === 'rush') {
    const full = makeFullImg(primary, 'full rush-face')
    const ghost = makeFullImg(secondary || primary, 'full rush-ghost')
    const flash = document.createElement('div')
    flash.className = 'flash'
    const flash2 = document.createElement('div')
    flash2.className = 'flash flash-red'
    const tear = document.createElement('div')
    tear.className = 'scare-tear scare-tear-hard'
    el.append(ghost, full, tear, flash, flash2, makeTxt('scare-txt-slam'))
  } else if (mode === 'double') {
    const a = makeFullImg(primary, 'full split-a')
    const b = makeFullImg(
      secondary === primary ? pick(faces) || primary : secondary || primary,
      'full split-b',
    )
    const flash = document.createElement('div')
    flash.className = 'flash'
    const flash2 = document.createElement('div')
    flash2.className = 'flash flash-white-strobe'
    const tear = document.createElement('div')
    tear.className = 'scare-tear scare-tear-hard'
    el.append(a, b, tear, flash, flash2, makeTxt())
  } else if (mode === 'close') {
    const full = makeFullImg(primary, 'full close-face')
    const flash = document.createElement('div')
    flash.className = 'flash'
    const flash2 = document.createElement('div')
    flash2.className = 'flash flash-red'
    const flash3 = document.createElement('div')
    flash3.className = 'flash flash-white-strobe'
    const tear = document.createElement('div')
    tear.className = 'scare-tear scare-tear-hard'
    const vignette = document.createElement('div')
    vignette.className = 'scare-vignette'
    el.append(full, tear, vignette, flash, flash2, flash3, makeTxt('scare-txt-slam'))
  } else if (mode === 'static') {
    const full = makeFullImg(primary)
    const tear = document.createElement('div')
    tear.className = 'scare-tear scare-tear-hard'
    const flash = document.createElement('div')
    flash.className = 'flash'
    const noise = document.createElement('div')
    noise.className = 'scare-noise'
    el.append(full, tear, noise, flash, makeTxt())
  } else {
    const full = makeFullImg(primary, 'full face-slam')
    const flash = document.createElement('div')
    flash.className = 'flash'
    const flash2 = document.createElement('div')
    flash2.className = 'flash flash-red'
    const flash3 = document.createElement('div')
    flash3.className = 'flash flash-white-strobe'
    const tear = document.createElement('div')
    tear.className = 'scare-tear'
    el.append(full, tear, flash, flash2, flash3, makeTxt('scare-txt-slam'))
  }

  if (brutality > 0.5) {
    const crt = document.createElement('div')
    crt.className = 'scare-crt'
    el.appendChild(crt)
  }
  return el
}

function blastAudio(brutality: number) {
  const screams = scarePool()
  const impacts = impactPool()
  void play(CUSTOM_SFX.scream, 0.95 + brutality * 0.05)
  setTimeout(() => void play(pick(screams) || CUSTOM_SFX.scream, 0.8), 30)
  setTimeout(() => void play(pick(impacts) || CUSTOM_SFX.scream, 0.72), 70)
  setTimeout(() => void playSnippet(CUSTOM_SFX.laugh, 0.6 + brutality * 0.25, 2.4), 120)
  setTimeout(() => void playSnippet(CUSTOM_SFX.ghost, 0.48, 2), 220)
  if (brutality > 0.4) {
    setTimeout(() => void play(CUSTOM_SFX.scream, 0.78, 0.12, 1.6), 380)
    setTimeout(() => void play(sfx('glass'), 0.55), 450)
  }
  if (brutality > 0.65) {
    setTimeout(() => void playSnippet(CUSTOM_SFX.watching, 0.55, 3.2), 600)
    setTimeout(() => void play(pick(screams) || CUSTOM_SFX.scream, 0.7), 900)
  }
  if (brutality > 0.85) {
    setTimeout(() => void play(CUSTOM_SFX.scream, 0.9, 0.4, 1.8), 1100)
    setTimeout(() => void playSnippet(CUSTOM_SFX.laugh, 0.7, 3), 1400)
  }
}

export function jumpscare(opts: JumpscareOpts = {}) {
  const brutality = Math.min(1, Math.max(0, opts.brutality ?? 0.6))
  if (scareBusy) return
  const cooldown = opts.force ? 0 : Math.max(7000, 20000 - brutality * 10000)
  if (!opts.force && Date.now() - lastScare < cooldown) return
  scareBusy = true
  lastScare = Date.now()
  if (!getBoot()) void loadBoot()
  warmScareImages()

  blastAudio(brutality)

  const mode = pickMode(brutality)
  const el = buildScareDom(mode, brutality)
  document.body.appendChild(el)
  document.body.classList.add('shake-hard', 'scare-invert')
  document.documentElement.classList.add('crt-blowout')
  if (brutality > 0.7) document.body.classList.add('scare-blood')

  let swapTimer = 0
  if (brutality > 0.5) {
    swapTimer = window.setTimeout(() => {
      const imgs = el.querySelectorAll('img.full, img.entity')
      const next = pick(brutalFaces())
      if (next) {
        imgs.forEach((node) => {
          const im = node as HTMLImageElement
          if (Math.random() > 0.35) im.src = next
        })
      }
      el.classList.add('scare-swap')
      void play(pick(impactPool()) || CUSTOM_SFX.scream, 0.55)
    }, 480 + Math.random() * 400)
  }

  let invert2 = 0
  if (brutality > 0.8) {
    invert2 = window.setTimeout(() => {
      document.body.classList.remove('scare-invert')
      requestAnimationFrame(() => document.body.classList.add('scare-invert'))
      void play(CUSTOM_SFX.scream, 0.65, 0.2, 0.9)
    }, 900)
  }

  const hold = 1800 + brutality * 1800
  setTimeout(() => {
    if (swapTimer) clearTimeout(swapTimer)
    if (invert2) clearTimeout(invert2)
    el.remove()
    document.body.classList.remove('shake-hard', 'scare-invert', 'scare-blood')
    document.documentElement.classList.remove('crt-blowout')
    scareBusy = false
  }, hold)
}

export function isScareBusy() {
  return scareBusy
}

export function pickBrutalFace() {
  return pick(brutalFaces()) || ''
}

/** @deprecated path pools removed — use boot */
export const BRUTAL_FACES: string[] = []
export const SCARE_IMGS: string[] = []
