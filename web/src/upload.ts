/**
 * Submission queue — IP rate limit + description (2000 chars) + Turnstile.
 * No browser-side file mirror (privacy).
 */

const MAX_BYTES = 12 * 1024 * 1024
const MAX_CHARS = 2000
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/webm',
  'video/mp4',
  'video/quicktime',
])

export type PendingSub = {
  id: string
  name: string
  type: string
  size: number
  description: string
  created: number
  status: 'pending'
}

export type RateStatus = {
  remaining: number
  retryAfter: number
  limit: number
  windowSec: number
  maxDescChars: number
}

type PublicConfig = {
  turnstileSiteKey: string | null
  requireTurnstile: boolean
  maxDescChars: number
}

let publicConfigCache: PublicConfig | null = null
let turnstileScriptPromise: Promise<void> | null = null

export async function countPending(): Promise<number> {
  return 0
}

function sanitizeName(name: string) {
  return name.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 120)
}

export function charCount(text: string) {
  return Array.from(String(text || '')).length
}

export function validateFile(file: File): string | null {
  if (!ALLOWED.has(file.type)) return 'only jpg/png/webp/gif/webm/mp4'
  if (file.size <= 0 || file.size > MAX_BYTES) return 'max 12MB'
  if (/\.(html?|svg|js|mjs|css|exe|php|sh)$/i.test(file.name)) return 'blocked type'
  return null
}

export function validateDescription(text: string): string | null {
  const s = String(text || '').trim()
  if (!s) return 'description required'
  if (charCount(s) > MAX_CHARS) return `description max ${MAX_CHARS} characters`
  return null
}

export async function fetchRateStatus(): Promise<RateStatus | null> {
  try {
    const res = await fetch('/api/upload/status', { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return {
      remaining: Number(data.remaining) || 0,
      retryAfter: Number(data.retryAfter) || 0,
      limit: Number(data.limit) || 5,
      windowSec: Number(data.windowSec) || 300,
      maxDescChars: Number(data.maxDescChars) || MAX_CHARS,
    }
  } catch {
    return null
  }
}

async function fetchPublicConfig(): Promise<PublicConfig> {
  if (publicConfigCache) return publicConfigCache
  try {
    const res = await fetch('/api/public/config', { cache: 'no-store' })
    const data = await res.json()
    publicConfigCache = {
      turnstileSiteKey: data.turnstileSiteKey || null,
      requireTurnstile: Boolean(data.requireTurnstile),
      maxDescChars: Number(data.maxDescChars) || MAX_CHARS,
    }
  } catch {
    publicConfigCache = {
      turnstileSiteKey: null,
      requireTurnstile: false,
      maxDescChars: MAX_CHARS,
    }
  }
  return publicConfigCache
}

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('turnstile failed to load'))
    document.head.appendChild(s)
  })
  return turnstileScriptPromise
}

export async function queueUpload(
  file: File,
  description: string,
  turnstileToken = '',
): Promise<PendingSub & { remaining: number }> {
  const err = validateFile(file)
  if (err) throw new Error(err)
  const derr = validateDescription(description)
  if (derr) throw new Error(derr)

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': sanitizeName(file.name),
      'X-File-Type': file.type || 'application/octet-stream',
      'X-Description': encodeURIComponent(description.trim()),
      'X-Turnstile-Token': turnstileToken,
    },
    body: file,
    cache: 'no-store',
  })

  let data: {
    ok?: boolean
    id?: string
    error?: string
    remaining?: number
    retryAfter?: number
  } = {}
  try {
    data = await res.json()
  } catch {
    /* ignore */
  }

  if (res.status === 429) {
    const wait = data.retryAfter ? `${data.retryAfter}s` : 'a few minutes'
    throw new Error(`rate limit — 5 per 5 min · try again in ${wait}`)
  }
  if (!res.ok || !data.ok || !data.id) {
    throw new Error(data.error || 'upload failed')
  }

  const meta: PendingSub = {
    id: data.id,
    name: sanitizeName(file.name),
    type: file.type,
    size: file.size,
    description: description.trim(),
    created: Date.now(),
    status: 'pending',
  }
  return { ...meta, remaining: Number(data.remaining) || 0 }
}

export function mountUploadButton(parent: HTMLElement) {
  let btn = parent.querySelector<HTMLButtonElement>('.upload-fab')
  if (btn) return btn
  btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'upload-fab'
  btn.textContent = 'UPLOAD'
  btn.title = 'submit photo/video for review · 5 per 5 min per IP'
  btn.addEventListener('click', () => openUploadModal())
  parent.appendChild(btn)
  return btn
}

function openUploadModal() {
  if (document.querySelector('.upload-modal')) return
  const modal = document.createElement('div')
  modal.className = 'upload-modal'

  const box = document.createElement('div')
  box.className = 'upload-box'

  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'tear-x'
  x.textContent = 'x'

  const h3 = document.createElement('h3')
  h3.textContent = 'SUBMIT'

  const sub = document.createElement('p')
  sub.className = 'sub'
  sub.textContent =
    'photos or videos · max 12MB · description required (2000 characters) · 5 / 5 min per IP · anonymous pending review'

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/jpeg,image/png,image/webp,image/gif,video/webm,video/mp4,video/quicktime'

  const descLabel = document.createElement('label')
  descLabel.className = 'udesc-label'
  descLabel.textContent = 'Describe this photo or video'

  const descHint = document.createElement('p')
  descHint.className = 'udesc-hint'
  descHint.textContent =
    'Say where it is from, what is happening, and why it feels paranormal / occult / wrong. Be specific. Do not include your name, phone, address, or socials.'

  const desc = document.createElement('textarea')
  desc.className = 'udesc'
  desc.rows = 5
  desc.maxLength = MAX_CHARS
  desc.placeholder =
    'Example: Found on a wiped SD card from a cabin outside X. Night-vision still. Figure in the doorway that was not there on the walkthrough. Max 2000 characters.'

  const counter = document.createElement('p')
  counter.className = 'uwords'
  counter.textContent = `0 / ${MAX_CHARS} characters`

  const tsSlot = document.createElement('div')
  tsSlot.className = 'uturnstile'

  const status = document.createElement('p')
  status.className = 'ustatus'

  const submit = document.createElement('button')
  submit.type = 'button'
  submit.className = 'usubmit'
  submit.disabled = true
  submit.textContent = 'queue for review'

  box.append(x, h3, sub, input, descLabel, descHint, desc, counter, tsSlot, status, submit)
  modal.appendChild(box)
  document.body.appendChild(modal)

  let file: File | null = null
  let widgetId: string | null = null
  let cfg: PublicConfig | null = null

  const close = () => modal.remove()
  x.addEventListener('click', close)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close()
  })

  const syncEnabled = () => {
    const n = charCount(desc.value)
    counter.textContent = `${n} / ${MAX_CHARS} characters`
    counter.classList.toggle('bad', n > MAX_CHARS)
    const okFile = !!file && !validateFile(file)
    const okDesc = !validateDescription(desc.value)
    submit.disabled = !(okFile && okDesc)
  }

  desc.addEventListener('input', syncEnabled)

  void (async () => {
    const rate = await fetchRateStatus()
    if (rate && !status.textContent) {
      status.textContent =
        rate.remaining <= 0
          ? `rate limited · try again in ${rate.retryAfter}s`
          : `${rate.remaining} of ${rate.limit} uploads left this window`
    }
    cfg = await fetchPublicConfig()
    if (cfg.requireTurnstile && cfg.turnstileSiteKey) {
      try {
        await loadTurnstileScript()
        if (window.turnstile) {
          widgetId = window.turnstile.render(tsSlot, {
            sitekey: cfg.turnstileSiteKey,
            theme: 'dark',
            size: 'flexible',
          })
        }
      } catch {
        status.textContent = 'bot check failed to load — refresh'
      }
    }
  })()

  input.addEventListener('change', () => {
    file = input.files?.[0] || null
    if (!file) {
      syncEnabled()
      return
    }
    const err = validateFile(file)
    if (err) {
      file = null
      status.textContent = err
      syncEnabled()
      return
    }
    status.textContent = `${sanitizeName(file.name)} · ${(file.size / 1024).toFixed(0)} KB`
    syncEnabled()
  })

  submit.addEventListener('click', async () => {
    if (!file) return
    const derr = validateDescription(desc.value)
    if (derr) {
      status.textContent = derr
      return
    }
    let token = ''
    if (cfg?.requireTurnstile) {
      if (!window.turnstile || widgetId == null) {
        status.textContent = 'bot check not ready'
        return
      }
      token = window.turnstile.getResponse(widgetId) || ''
      if (!token) {
        status.textContent = 'complete the bot check'
        return
      }
    }
    submit.disabled = true
    status.textContent = 'uploading…'
    try {
      const meta = await queueUpload(file, desc.value.trim(), token)
      const n = await countPending()
      status.textContent = `queued · ${n} local · ${meta.remaining} left this window`
      file = null
      input.value = ''
      desc.value = ''
      syncEnabled()
      if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId)
      setTimeout(close, 1400)
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'failed'
      submit.disabled = false
      if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId)
    }
  })
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      getResponse: (id: string) => string
      reset: (id: string) => void
    }
  }
}
