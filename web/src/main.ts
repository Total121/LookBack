import './style.css'
import { armHaunt, jumpscare, play } from './audio/haunt'
import { askWebcamPossession, closeWebcam } from './webcam'
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

const root = document.querySelector<HTMLDivElement>('#app')!
const MAX_STRIPS = 6
const MAX_PLAYING_VIDEOS = 2
const TILES_PER_STRIP = 18

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
let appending = false
let playingVideos = new Set<HTMLVideoElement>()
let sentinelObserver: IntersectionObserver | null = null

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
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

function openPhotoStory(p: PhotoStory) {
  closeTear()
  void play('/sfx/creak.wav', 0.2)
  const tear = document.createElement('div')
  tear.className = 'tear'
  const inner = document.createElement('div')
  inner.className = 'tear-inner'
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'tear-x'
  x.textContent = 'x'
  x.onclick = () => closeTear()
  const img = document.createElement('img')
  img.className = 'hero'
  img.src = p.src
  img.alt = ''
  img.decoding = 'async'
  const h = document.createElement('h3')
  h.className = 'gothic'
  h.textContent = p.title
  const rating = document.createElement('div')
  rating.className = 'rating'
  rating.textContent = p.rating
  const body = document.createElement('div')
  body.className = 'body'
  body.textContent = p.story
  inner.append(x, img, h, rating, body)
  tear.appendChild(inner)
  tear.addEventListener('click', (e) => {
    if (e.target === tear) closeTear()
  })
  document.body.appendChild(tear)
}

function openMurder(m: MurderFile) {
  closeTear()
  void play('/sfx/heartbeat.wav', 0.2)
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
  img.src = pick([
    '/media/nv-silhouette.jpg',
    '/media/hall-entity.jpg',
    '/media/closet-eyes.jpg',
    '/media/jumpscare-face.jpg',
  ])
  img.alt = ''
  el.append(lbl, img)
  document.body.appendChild(el)
  void play('/sfx/ghost2.wav', 0.3)
  setTimeout(() => el.remove(), 1400)
}

function trackVideo(strip: HTMLElement, vid: HTMLVideoElement) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
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
        }
      }
    },
    { threshold: 0.25, rootMargin: '40px' },
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
    } catch { /* ignore */ }
  })
  const bag = (strip as HTMLElement & { _vos?: IntersectionObserver[] })._vos
  bag?.forEach((o) => o.disconnect())
  strip.remove()
}

/**
 * Recycle only strips fully above the viewport.
 * Preserve document height with a top spacer so scroll never jumps or locks.
 */
function recycleStrips() {
  if (!chaosEl || !spacerEl) return
  const strips = [...chaosEl.querySelectorAll<HTMLElement>('.chaos-strip')]
  if (strips.length <= MAX_STRIPS) return

  const keepFromBottom = MAX_STRIPS
  const removable = strips.slice(0, Math.max(0, strips.length - keepFromBottom))
  for (const strip of removable) {
    const rect = strip.getBoundingClientRect()
    // only remove if completely above viewport with buffer
    if (rect.bottom > -200) break
    const h = strip.offsetHeight || rect.height || window.innerHeight
    removedHeight += h
    spacerEl.style.height = removedHeight + 'px'
    destroyStrip(strip)
  }
}

function layoutStrip(strip: HTMLElement, count: number) {
  const frag = document.createDocumentFragment()
  for (let i = 0; i < count; i++) {
    const kindRoll = Math.random()
    let kind: 'photo' | 'video' | 'case' | 'ask' = 'photo'
    if (kindRoll > 0.76) kind = 'video'
    else if (kindRoll > 0.9) kind = 'case'
    else if (kindRoll > 0.985 && !webcamAsked && stripN > 3) kind = 'ask'

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
      tile.addEventListener('click', () => openPhotoStory(p))
    } else if (kind === 'video') {
      const v = videoPool.next()
      if (!v) continue
      tile.classList.add('video-tile')
      const vid = document.createElement('video')
      vid.playsInline = true
      vid.loop = true
      vid.muted = true
      vid.preload = 'none'
      vid.setAttribute('src', v.src)
      const cap = document.createElement('div')
      cap.className = 'cap'
      cap.textContent = '● ' + v.label
      tile.append(vid, cap)
      trackVideo(strip, vid)
      tile.addEventListener('click', (e) => {
        e.stopPropagation()
        vid.muted = !vid.muted
        void vid.play().catch(() => {})
      })
    } else if (kind === 'case') {
      tile.classList.add('case-tile')
      if (!CASES.length) continue
      const m = CASES[caseI % CASES.length]
      caseI++
      const h4 = document.createElement('h4')
      h4.textContent = m.title
      const r = document.createElement('div')
      r.className = 'r'
      r.textContent = m.rating
      const p = document.createElement('p')
      p.textContent = m.body.slice(0, 110) + '…'
      tile.append(h4, r, p)
      tile.addEventListener('click', () => openMurder(m))
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

  for (let i = 0; i < 3; i++) {
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
    tile.addEventListener('click', () => openPhotoStory(p))
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
    chaosEl.appendChild(sent) // keep at end
  }
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
      // insert before sentinel if present
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
    // unlock after layout settles so sentinel doesn't loop
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
    { root: null, rootMargin: '400px 0px', threshold: 0 },
  )
  sentinelObserver.observe(el)
}

function onScrollRare() {
  // opportunistic recycle while scrolling up-content away
  if (!appending) recycleStrips()
  if (Date.now() - lastScrollScare < 60000) return
  if (Math.random() > 0.9988) {
    lastScrollScare = Date.now()
    if (Math.random() > 0.5) jumpscare()
    else behindOverlay()
  }
}

async function preloadSome(urls: string[], onProgress: (pct: number, label: string) => void) {
  const total = Math.max(1, urls.length)
  let done = 0
  await Promise.all(
    urls.map(async (url) => {
      try {
        if (url.endsWith('.webm') || url.endsWith('.wav')) {
          await fetch(url, { cache: 'force-cache' })
        } else {
          await new Promise<void>((resolve) => {
            const img = new Image()
            img.onload = () => resolve()
            img.onerror = () => resolve()
            img.src = url
          })
        }
      } catch { /* ignore */ }
      done++
      onProgress(Math.round((done / total) * 100), 'opening…')
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
  root.innerHTML = `<section class="loading">
    <div class="loading-card">
      <div class="badge">LOADING</div>
      <h1 class="gothic">LOOK<br/>BACK</h1>
      <p class="load-msg" id="lmsg">opening…</p>
      <div class="bar"><div class="fill" id="lfill"></div></div>
      <p class="load-pct" id="lpct">0%</p>
    </div>
  </section>`
  ensureChrome()

  const fill = root.querySelector<HTMLElement>('#lfill')!
  const pct = root.querySelector('#lpct')!
  const msg = root.querySelector('#lmsg')!
  const subset = preloadSubset(photos, videos)

  void (async () => {
    // Fast path: no artificial long wait — just preload a tiny subset
    const minTime = new Promise((r) => setTimeout(r, 350))
    await Promise.all([
      preloadSome(subset, (p, label) => {
        fill.style.width = p + '%'
        pct.textContent = p + '%'
        msg.textContent = label
      }),
      minTime,
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

  root.innerHTML = `<div class="feed">
    <div class="feed-top">
      <span>LOOK BACK</span>
      <span class="blink" style="color:#c00">●</span>
      <span>R18 · ${photos.length} stills · ${videos.length} tapes</span>
    </div>
    <div class="chaos" id="chaos">
      <div class="chaos-spacer" id="spacer"></div>
    </div>
  </div>`
  ensureChrome()
  chaosEl = root.querySelector('#chaos')
  spacerEl = root.querySelector('#spacer')
  appendStrips(2)
  window.removeEventListener('scroll', onScrollRare)
  window.addEventListener('scroll', onScrollRare, { passive: true })

  // build case dump off the critical path
  if (!CASES.length) {
    const run = () => {
      CASES = buildCaseDump(2200)
    }
    if ('requestIdleCallback' in window) {
      ;(window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run)
    } else {
      setTimeout(run, 100)
    }
  }
}

function leave() {
  closeWebcam()
  root.innerHTML = `<div class="gate"><div class="gate-card"><h1 class="gothic">𝖌𝖔𝖔𝖉</h1><p>It waits.</p></div></div>`
}

function gate() {
  root.innerHTML = `<section class="gate">
    <div class="gate-card">
      <div class="badge">RESTRICTED 18+</div>
      <h1 class="gothic">LOOK<br/>BACK</h1>
      <div class="tag">anonymous · stills · tapes · submit</div>
      <p>Infinite collage. Tap photos for what happened. Jump scares are rare. Upload is pending review.</p>
      <ul>
        <li>Violence, blood, murder files</li>
        <li>Nudity &amp; sexual content</li>
        <li>Paranormal / occult</li>
        <li>Rare heavy jump scares</li>
        <li>Optional webcam ghost overlay</li>
      </ul>
      <label><input type="checkbox" id="age"/> I am 18 or older — enter at my own risk</label>
      <button type="button" class="enter-btn" id="enter" disabled>ENTER</button>
      <button type="button" class="deny" id="deny">I am under 18 — leave</button>
    </div>
  </section>`

  const age = root.querySelector<HTMLInputElement>('#age')!
  const enter = root.querySelector<HTMLButtonElement>('#enter')!
  age.addEventListener('change', () => {
    enter.disabled = !age.checked
  })
  enter.addEventListener('click', async () => {
    if (!age.checked) return
    enter.disabled = true
    enter.textContent = '…'
    try {
      await armHaunt()
      const [photos, videos] = await Promise.all([loadAllPhotos(), loadAllVideos()])
      showLoadingThenFeed(photos, videos)
    } catch {
      enter.disabled = false
      enter.textContent = 'ENTER'
    }
  })
  root.querySelector('#deny')!.addEventListener('click', leave)
}

installGuards()
gate()
