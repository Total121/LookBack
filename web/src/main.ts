import './style.css'
import { armHaunt, jumpscare, play } from './audio/haunt'
import { askWebcamPossession, closeWebcam } from './webcam'
import {
  startDread,
  onDreadScroll,
  dreadIntensity,
  setDreadMultiplier,
  setAmbientEnabled,
  stopDread,
} from './dread'
import {
  loadAllPhotos,
  loadAllVideos,
  buildCaseDump,
  preloadSubset,
  type PhotoStory,
  type FeedVid,
  type MurderFile,
} from './data/horror'
import { MediaPool } from './pool'
import { mountUploadButton } from './upload'
import { installGuards } from './guard'
import { enableTileDrag, resetDragLayer } from './drag'
import { loadBoot, bootFaces, bootSfx } from './boot'

const root = document.querySelector<HTMLDivElement>('#app')!
const MAX_STRIPS = 5
const MAX_PLAYING_VIDEOS = 2
const TILES_PER_STRIP = 14
const SPACER_CAP_VH = 8

const photoPool = new MediaPool<PhotoStory>()
const videoPool = new MediaPool<FeedVid>()
let CASES: MurderFile[] = []
let caseI = 0
let stripN = 0
let webcamAsked = false
let chaosEl: HTMLElement | null = null
let spacerEl: HTMLElement | null = null
let removedHeight = 0
let lastScrollScare = 0
let lastScrollCheck = 0
let appending = false
let playingVideos = new Set<HTMLVideoElement>()
let sentinelObserver: IntersectionObserver | null = null
let casesPromise: Promise<MurderFile[]> | null = null

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function ensureCases() {
  if (CASES.length) return Promise.resolve(CASES)
  if (!casesPromise) {
    casesPromise = Promise.resolve().then(() => {
      CASES = buildCaseDump(400)
      return CASES
    })
  }
  return casesPromise
}

function closeTear() {
  document.querySelectorAll('.tear').forEach((el) => el.remove())
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTear()
    document.querySelectorAll('.upload-modal').forEach((el) => el.remove())
  }
})

function openMediaStory(opts: {
  src: string
  title: string
  rating: string
  story: string
  kind: 'photo' | 'video'
}) {
  closeTear()
  void play(opts.kind === 'video' ? bootSfx('static') : bootSfx('creak'), 0.2)
  const tear = document.createElement('div')
  tear.className = 'tear'
  const inner = document.createElement('div')
  inner.className = 'tear-inner'
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'tear-x'
  x.textContent = 'x'
  x.onclick = () => closeTear()

  let media: HTMLElement
  if (opts.kind === 'video') {
    const vid = document.createElement('video')
    vid.className = 'hero'
    vid.src = opts.src
    vid.controls = true
    vid.playsInline = true
    vid.loop = true
    vid.autoplay = true
    vid.muted = false
    media = vid
    void vid.play().catch(() => {
      vid.muted = true
      void vid.play().catch(() => {})
    })
  } else {
    const img = document.createElement('img')
    img.className = 'hero'
    img.src = opts.src
    img.alt = ''
    img.decoding = 'async'
    media = img
  }

  const h = document.createElement('h3')
  h.className = 'gothic'
  h.textContent = opts.title
  const rating = document.createElement('div')
  rating.className = 'rating'
  rating.textContent = opts.rating
  const body = document.createElement('div')
  body.className = 'body'
  body.textContent = opts.story || 'No description filed.'
  inner.append(x, media, h, rating, body)
  tear.appendChild(inner)
  tear.addEventListener('click', (e) => {
    if (e.target === tear) closeTear()
  })
  document.body.appendChild(tear)
}

function openPhotoStory(p: PhotoStory) {
  openMediaStory({
    src: p.src,
    title: p.title,
    rating: p.rating,
    story: p.story,
    kind: 'photo',
  })
}

function openVideoStory(v: FeedVid) {
  openMediaStory({
    src: v.src,
    title: v.title || v.label,
    rating: v.rating,
    story: v.story,
    kind: 'video',
  })
}

function openMurder(m: MurderFile) {
  closeTear()
  void play(bootSfx('heartbeat'), 0.2)
  const tear = document.createElement('div')
  tear.className = 'tear'
  const inner = document.createElement('div')
  inner.className = 'tear-inner'
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'tear-x'
  x.textContent = 'x'
  x.onclick = closeTear
  const h = document.createElement('h3')
  h.className = 'gothic'
  h.textContent = m.title
  const rating = document.createElement('div')
  rating.className = 'rating'
  rating.textContent = m.rating
  const body = document.createElement('div')
  body.className = 'body'
  body.textContent = m.body
  inner.append(x, h, rating, body)
  tear.appendChild(inner)
  tear.addEventListener('click', (e) => {
    if (e.target === tear) closeTear()
  })
  document.body.appendChild(tear)
}

function behindOverlay() {
  const el = document.createElement('div')
  el.className = 'behind-overlay'
  const lbl = document.createElement('div')
  lbl.className = 'lbl'
  lbl.textContent = 'behind you'
  const img = document.createElement('img')
  const faces = bootFaces()
  if (!faces.length) return
  img.src = pick(faces)
  img.alt = ''
  el.append(lbl, img)
  document.body.appendChild(el)
  void play(bootSfx('ghost2') || bootSfx('ghost'), 0.3)
  setTimeout(() => el.remove(), 1400)
}

function trackVideo(strip: HTMLElement, vid: HTMLVideoElement, src: string) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          if (!vid.getAttribute('src')) {
            vid.setAttribute('src', src)
            vid.load()
          }
          if (playingVideos.size >= MAX_PLAYING_VIDEOS) {
            const first = playingVideos.values().next().value
            if (first && first !== vid) {
              first.pause()
              playingVideos.delete(first)
            }
          }
          void vid.play().catch(() => {})
          playingVideos.add(vid)
        } else {
          vid.pause()
          playingVideos.delete(vid)
          // drop decoded frames when far off-screen
          if (e.intersectionRatio === 0 && e.boundingClientRect.bottom < -400) {
            vid.removeAttribute('src')
            try {
              vid.load()
            } catch {
              /* ignore */
            }
          }
        }
      }
    },
    { threshold: 0.2, rootMargin: '120px' },
  )
  io.observe(vid)
  const bag = (strip as HTMLElement & { _vos?: IntersectionObserver[] })._vos || []
  bag.push(io)
  ;(strip as HTMLElement & { _vos?: IntersectionObserver[] })._vos = bag
}

function destroyStrip(strip: HTMLElement) {
  strip.querySelectorAll('video').forEach((v) => {
    v.pause()
    playingVideos.delete(v)
    v.removeAttribute('src')
    try {
      v.load()
    } catch {
      /* ignore */
    }
  })
  const bag = (strip as HTMLElement & { _vos?: IntersectionObserver[] })._vos
  bag?.forEach((o) => o.disconnect())
  strip.remove()
}

/**
 * Recycle strips fully above the viewport.
 * Spacer preserves scroll position, capped so document height cannot grow forever.
 */
function recycleStrips() {
  if (!chaosEl || !spacerEl) return
  const strips = [...chaosEl.querySelectorAll<HTMLElement>('.chaos-strip')]
  if (strips.length <= MAX_STRIPS) return

  const keepFromBottom = MAX_STRIPS
  const removable = strips.slice(0, Math.max(0, strips.length - keepFromBottom))
  const spacerCap = window.innerHeight * SPACER_CAP_VH

  for (const strip of removable) {
    const rect = strip.getBoundingClientRect()
    if (rect.bottom > -160) break
    const h = strip.offsetHeight || rect.height || window.innerHeight
    if (removedHeight + h <= spacerCap) {
      removedHeight += h
      spacerEl.style.height = removedHeight + 'px'
    } else {
      // collapse excess: drop height and jump scroll by the same amount
      const overflow = removedHeight + h - spacerCap
      const prev = window.scrollY
      removedHeight = spacerCap
      spacerEl.style.height = removedHeight + 'px'
      destroyStrip(strip)
      window.scrollTo(0, Math.max(0, prev - overflow))
      continue
    }
    destroyStrip(strip)
  }
}

function pickKind(): 'photo' | 'video' | 'case' | 'ask' {
  const kindRoll = Math.random()
  // rarest checks first — previously video (>=0.76) ate case/ask forever
  if (kindRoll > 0.985 && !webcamAsked && stripN > 3) return 'ask'
  if (kindRoll > 0.9) return 'case'
  if (kindRoll > 0.76) return 'video'
  return 'photo'
}

function layoutStrip(strip: HTMLElement, count: number) {
  const frag = document.createDocumentFragment()
  for (let i = 0; i < count; i++) {
    const kind = pickKind()

    const tile = document.createElement('div')
    tile.className = 'tile'

    const sizeRoll = Math.random()
    let w: number
    let h: number
    if (sizeRoll < 0.2) {
      w = 24 + Math.random() * 16
      h = 20 + Math.random() * 14
    } else if (sizeRoll < 0.85) {
      w = 14 + Math.random() * 12
      h = 14 + Math.random() * 12
    } else {
      w = 10 + Math.random() * 7
      h = 10 + Math.random() * 8
    }
    if (kind === 'video') {
      w = Math.max(w, 18)
      h = Math.max(h, 14)
    }
    if (kind === 'case' || kind === 'ask') {
      w = 18 + Math.random() * 10
      h = 16 + Math.random() * 10
    }

    const left = Math.random() * Math.max(1, 100 - w - 1)
    const top = Math.random() * Math.max(1, 100 - h - 1)
    const rot = (Math.random() - 0.5) * 12
    tile.style.cssText = `left:${left}%;top:${top}%;width:${w}%;height:${h}%;z-index:${1 + ((Math.random() * 5) | 0)};--r:${rot}deg;transform:rotate(${rot}deg)`

    if (kind === 'photo') {
      const p = photoPool.next()
      if (!p) continue
      const img = document.createElement('img')
      img.src = p.src
      img.alt = ''
      img.loading = 'lazy'
      img.decoding = 'async'
      if (Math.random() < 0.3) img.style.filter = 'contrast(1.55) grayscale(.8) brightness(.7)'
      const cap = document.createElement('div')
      cap.className = 'cap'
      cap.textContent = p.title
      tile.append(img, cap)
      tile.addEventListener('click', () => openPhotoStory(p), { passive: true })
      enableTileDrag(tile)
    } else if (kind === 'video') {
      const v = videoPool.next()
      if (!v) continue
      tile.classList.add('video-tile')
      const vid = document.createElement('video')
      vid.playsInline = true
      vid.loop = true
      vid.muted = true
      vid.preload = 'none'
      vid.dataset.mediaSrc = v.src
      const cap = document.createElement('div')
      cap.className = 'cap'
      cap.textContent = '● ' + v.label
      tile.append(vid, cap)
      trackVideo(strip, vid, v.src)
      tile.addEventListener('click', (e) => {
        e.stopPropagation()
        openVideoStory(v)
      })
      enableTileDrag(tile, {
        onFreed: (t) => {
          const freedVid = t.querySelector('video')
          if (freedVid && chaosEl) {
            trackVideo(chaosEl, freedVid, freedVid.dataset.mediaSrc || v.src)
          }
        },
      })
    } else if (kind === 'case') {
      tile.classList.add('case-tile')
      void ensureCases().then(() => {
        if (!CASES.length || !tile.isConnected) return
        const m = CASES[caseI % CASES.length]
        caseI++
        tile.replaceChildren()
        const h4 = document.createElement('h4')
        h4.textContent = m.title
        const r = document.createElement('div')
        r.className = 'r'
        r.textContent = m.rating
        const p = document.createElement('p')
        p.textContent = m.body.slice(0, 110) + '…'
        tile.append(h4, r, p)
        tile.addEventListener('click', () => openMurder(m), { passive: true })
      })
    } else {
      tile.classList.add('ask-tile')
      const t = document.createElement('div')
      t.className = 'gothic'
      t.style.cssText = 'color:#f33;font-size:16px'
      t.textContent = '𝖈𝖆𝖓 𝖎 𝖘𝖊𝖊 𝖞𝖔𝖚'
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = 'yes — camera'
      b.addEventListener('click', async (e) => {
        e.stopPropagation()
        webcamAsked = true
        await askWebcamPossession()
      })
      tile.append(t, b)
    }
    frag.appendChild(tile)
  }

  for (let i = 0; i < 2; i++) {
    const p = photoPool.next()
    if (!p) break
    const tile = document.createElement('div')
    tile.className = 'tile'
    const w = 26 + Math.random() * 16
    const h = 24 + Math.random() * 16
    const rot = (Math.random() - 0.5) * 8
    tile.style.cssText = `left:${Math.random() * (100 - w)}%;top:${Math.random() * (100 - h)}%;width:${w}%;height:${h}%;z-index:${4 + i};--r:${rot}deg;transform:rotate(${rot}deg)`
    const img = document.createElement('img')
    img.src = p.src
    img.alt = ''
    img.loading = 'lazy'
    img.decoding = 'async'
    const cap = document.createElement('div')
    cap.className = 'cap'
    cap.textContent = p.title
    tile.append(img, cap)
    tile.addEventListener('click', () => openPhotoStory(p), { passive: true })
    enableTileDrag(tile)
    frag.appendChild(tile)
  }
  strip.appendChild(frag)
}

function placeSentinel() {
  if (!chaosEl) return
  let sent = chaosEl.querySelector<HTMLElement>('.sentinel')
  if (!sent) {
    sent = document.createElement('div')
    sent.className = 'sentinel'
    chaosEl.appendChild(sent)
  } else {
    chaosEl.appendChild(sent)
  }
  const free = chaosEl.querySelector('.chaos-free')
  if (free) chaosEl.appendChild(free)
  observeSentinel(sent)
}

function appendStrips(n = 1) {
  if (!chaosEl || appending) return
  appending = true
  try {
    for (let s = 0; s < n; s++) {
      stripN++
      const strip = document.createElement('div')
      strip.className = 'chaos-strip'
      const sent = chaosEl.querySelector('.sentinel')
      if (sent) chaosEl.insertBefore(strip, sent)
      else chaosEl.appendChild(strip)
      layoutStrip(strip, TILES_PER_STRIP)
    }
    recycleStrips()
    placeSentinel()

    if (stripN === 4 && Math.random() > 0.7) setTimeout(() => behindOverlay(), 1000)
    if (stripN > 6 && !webcamAsked && Math.random() > 0.9) {
      webcamAsked = true
      void askWebcamPossession()
    }
  } finally {
    requestAnimationFrame(() => {
      appending = false
    })
  }
}

function observeSentinel(el: Element) {
  sentinelObserver?.disconnect()
  sentinelObserver = new IntersectionObserver(
    (entries) => {
      if (appending) return
      if (entries.some((e) => e.isIntersecting)) appendStrips(1)
    },
    { root: null, rootMargin: '320px 0px', threshold: 0 },
  )
  sentinelObserver.observe(el)
}

function onScrollRare() {
  const now = Date.now()
  if (now - lastScrollCheck < 250) return
  lastScrollCheck = now
  if (!appending) recycleStrips()
  onDreadScroll()
  const intensity = dreadIntensity()
  const scareCooldown = Math.max(14000, 52000 - intensity * 38000)
  if (now - lastScrollScare < scareCooldown) return
  const chance = 0.994 - intensity * 0.06
  if (Math.random() > chance) {
    lastScrollScare = now
    if (Math.random() > 0.28) jumpscare({ brutality: 0.55 + intensity * 0.45 })
    else behindOverlay()
  }
}

async function preloadSome(urls: string[], onProgress: (pct: number, label: string) => void) {
  const total = Math.max(1, urls.length)
  let done = 0
  const bump = (label: string) => {
    done++
    onProgress(Math.round((done / total) * 100), label)
  }
  await Promise.all(
    urls.map(async (url) => {
      try {
        if (url.endsWith('.wav')) {
          await fetch(url, { cache: 'force-cache' })
        } else {
          await new Promise<void>((resolve) => {
            const img = new Image()
            img.decoding = 'async'
            img.onload = () => resolve()
            img.onerror = () => resolve()
            img.src = url
          })
        }
      } catch {
        /* ignore */
      }
      bump('opening…')
    }),
  )
}

function ensureChrome() {
  let chrome = document.querySelector<HTMLElement>('.app-chrome')
  if (!chrome) {
    chrome = document.createElement('div')
    chrome.className = 'app-chrome'
    document.body.appendChild(chrome)
  }
  mountUploadButton(chrome)
}

function showLoadingThenFeed(photos: PhotoStory[], videos: FeedVid[]) {
  root.replaceChildren()
  const section = document.createElement('section')
  section.className = 'loading'
  const card = document.createElement('div')
  card.className = 'loading-card'
  const badge = document.createElement('div')
  badge.className = 'badge'
  badge.textContent = 'LOADING'
  const title = document.createElement('h1')
  title.className = 'gothic'
  title.innerHTML = 'LOOK<br/>BACK'
  const msg = document.createElement('p')
  msg.className = 'load-msg'
  msg.id = 'lmsg'
  msg.textContent = 'opening…'
  const bar = document.createElement('div')
  bar.className = 'bar'
  const fill = document.createElement('div')
  fill.className = 'fill'
  fill.id = 'lfill'
  bar.appendChild(fill)
  const pct = document.createElement('p')
  pct.className = 'load-pct'
  pct.id = 'lpct'
  pct.textContent = '0%'
  card.append(badge, title, msg, bar, pct)
  section.appendChild(card)
  root.appendChild(section)
  ensureChrome()

  const subset = preloadSubset(photos, videos)
  void (async () => {
    const minTime = new Promise((r) => setTimeout(r, 200))
    await Promise.all([
      preloadSome(subset, (p, label) => {
        fill.style.width = p + '%'
        pct.textContent = p + '%'
        msg.textContent = label
      }),
      minTime,
      ensureCases(),
    ])
    fill.style.width = '100%'
    pct.textContent = '100%'
    renderFeed(photos, videos)
  })()
}

function renderFeed(photos: PhotoStory[], videos: FeedVid[]) {
  closeWebcam()
  photoPool.reset(photos)
  videoPool.reset(videos)
  removedHeight = 0
  stripN = 0
  appending = false
  playingVideos.clear()
  sentinelObserver?.disconnect()
  resetDragLayer()

  root.replaceChildren()
  const feed = document.createElement('div')
  feed.className = 'feed'
  const top = document.createElement('div')
  top.className = 'feed-top'
  const a = document.createElement('span')
  a.textContent = 'LOOK BACK'
  const b = document.createElement('span')
  b.className = 'blink'
  b.style.color = '#c00'
  b.textContent = '●'
  const c = document.createElement('span')
  c.textContent = `R18 · ${photos.length} stills · ${videos.length} tapes`
  top.append(a, b, c)
  const chaos = document.createElement('div')
  chaos.className = 'chaos'
  chaos.id = 'chaos'
  const spacer = document.createElement('div')
  spacer.className = 'chaos-spacer'
  spacer.id = 'spacer'
  chaos.appendChild(spacer)
  feed.append(top, chaos)
  root.appendChild(feed)

  ensureChrome()
  chaosEl = chaos
  spacerEl = spacer
  appendStrips(2)
  window.removeEventListener('scroll', onScrollRare)
  window.addEventListener('scroll', onScrollRare, { passive: true })
  startDread()
}

function leave() {
  closeWebcam()
  root.replaceChildren()
  const gate = document.createElement('div')
  gate.className = 'gate'
  const card = document.createElement('div')
  card.className = 'gate-card'
  const h1 = document.createElement('h1')
  h1.className = 'gothic'
  h1.textContent = '𝖌𝖔𝖔𝖉'
  const p = document.createElement('p')
  p.textContent = 'It waits.'
  card.append(h1, p)
  gate.appendChild(card)
  root.appendChild(gate)
}

function gate() {
  root.replaceChildren()
  const section = document.createElement('section')
  section.className = 'gate'
  const card = document.createElement('div')
  card.className = 'gate-card'

  const badge = document.createElement('div')
  badge.className = 'badge'
  badge.textContent = 'RESTRICTED 18+'
  const h1 = document.createElement('h1')
  h1.className = 'gothic'
  h1.innerHTML = 'LOOK<br/>BACK'
  const tag = document.createElement('div')
  tag.className = 'tag'
  tag.textContent = 'anonymous · stills · tapes · submit'
  const p = document.createElement('p')
  p.textContent =
    'Infinite collage. Tap photos for what happened. Jump scares are rare. Uploads need a description (where / why paranormal · 2000 characters) and stay anonymous pending review (5 / 5 min per IP).'
  const ul = document.createElement('ul')
  for (const line of [
    'Violence, blood, murder files',
    'Nudity & sexual content',
    'Paranormal / occult',
    'Rare heavy jump scares',
    'Optional webcam ghost overlay',
  ]) {
    const li = document.createElement('li')
    li.textContent = line
    ul.appendChild(li)
  }
  const label = document.createElement('label')
  const age = document.createElement('input')
  age.type = 'checkbox'
  age.id = 'age'
  label.append(age, document.createTextNode(' I am 18 or older — enter at my own risk'))
  const enter = document.createElement('button')
  enter.type = 'button'
  enter.className = 'enter-btn'
  enter.id = 'enter'
  enter.disabled = true
  enter.textContent = 'ENTER'
  const deny = document.createElement('button')
  deny.type = 'button'
  deny.className = 'deny'
  deny.id = 'deny'
  deny.textContent = 'I am under 18 — leave'

  card.append(badge, h1, tag, p, ul, label, enter, deny)
  section.appendChild(card)
  root.appendChild(section)

  age.addEventListener('change', () => {
    enter.disabled = !age.checked
  })
  enter.addEventListener('click', async () => {
    if (!age.checked) return
    enter.disabled = true
    enter.textContent = '…'
    try {
      const cfgRes = await fetch('/api/public/config', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}))
      if (cfgRes?.maintenanceMode) {
        root.replaceChildren()
        const g = document.createElement('div')
        g.className = 'gate'
        const c = document.createElement('div')
        c.className = 'gate-card'
        const h = document.createElement('h1')
        h.className = 'gothic'
        h.textContent = 'CLOSED'
        const p = document.createElement('p')
        p.textContent = cfgRes.maintenanceMessage || 'It will open its eyes again.'
        c.append(h, p)
        g.appendChild(c)
        root.appendChild(g)
        return
      }
      if (cfgRes?.dreadMultiplier) setDreadMultiplier(Number(cfgRes.dreadMultiplier))
      if (typeof cfgRes?.ambientHaunt === 'boolean') setAmbientEnabled(cfgRes.ambientHaunt)
      if (cfgRes?.announcement) {
        const bar = document.createElement('div')
        bar.className = 'site-announce'
        bar.textContent = String(cfgRes.announcement)
        document.body.appendChild(bar)
      }
      await loadBoot(true)
      const [, photos, videos] = await Promise.all([armHaunt(), loadAllPhotos(), loadAllVideos()])
      showLoadingThenFeed(photos, videos)
    } catch {
      enter.disabled = false
      enter.textContent = 'ENTER'
    }
  })
  deny.addEventListener('click', () => {
    stopDread()
    leave()
  })
}

installGuards()
gate()
