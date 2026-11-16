/**
 * Opaque short-lived media tokens.
 * Real vault paths never leave the server; clients only see /m/<token>.
 */
import { createHmac, createCipheriv, createDecipheriv, timingSafeEqual, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import { clientIp, sendJson, apiRateLimit, applyAnonHeaders } from './security.mjs'
import { syncCatalogFromDisk } from './catalog.mjs'
import { getSettings, isBanned, publicSiteFlags } from './settings.mjs'
import { hasThumb, thumbRelForSrc } from './thumbs.mjs'

const TOKEN_TTL_MS = 20 * 60 * 1000
const BRUTAL_FACES = [
  '/media/js-hood-eyes.png',
  '/media/js-bed-shush.png',
  '/media/js-grin-teeth.png',
  '/media/js-void-jaw.png',
]
const LEGACY_SCARES = [
  '/media/jumpscare-face.jpg',
  '/media/crt-scream.jpg',
  '/media/static-face.jpg',
  '/media/nv-silhouette.jpg',
  '/media/closet-eyes.jpg',
  '/media/stair-hand.jpg',
  '/media/hall-entity.jpg',
  '/media/mirror-double.jpg',
]
const SFX_ALIASES = {
  laugh: 'evil-laugh.mp3',
  watching: 'shes-watching.mp3',
  scream: 'loud-scream.mp3',
  ghost: 'ghost-voice.mp3',
}

function sfxKey(name) {
  return String(name)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
}

function collectSfxTokens() {
  /** @type {Record<string, string>} */
  const sfx = {}
  const dir = path.join(config.vaultDir, 'sfx')
  if (!fs.existsSync(dir)) return sfx
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(wav|mp3|ogg)$/i.test(name)) continue
    const src = `/sfx/${name}`
    const abs = vaultAbs(src)
    if (!abs || !fs.existsSync(abs)) continue
    const url = tokenUrl(src)
    sfx[sfxKey(name)] = url
  }
  for (const [alias, file] of Object.entries(SFX_ALIASES)) {
    const src = `/sfx/${file}`
    if (vaultAbs(src) && fs.existsSync(vaultAbs(src))) sfx[alias] = tokenUrl(src)
  }
  return sfx
}

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
}

/** @type {Map<string, number[]>} */
const mediaHits = new Map()

function mediaKey() {
  return createHmac('sha256', config.sessionSecret || 'lb')
    .update('media-token-v1')
    .digest()
}

/** AES-256-GCM sealed token — path not readable from F12 URL alone. */
export function mintToken(src, ttlMs = TOKEN_TTL_MS) {
  const exp = Date.now() + ttlMs
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', mediaKey(), iv)
  const plain = Buffer.from(JSON.stringify({ s: src, e: exp }), 'utf8')
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64url')
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.length > 800) return null
  try {
    const buf = Buffer.from(token, 'base64url')
    if (buf.length < 28) return null
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', mediaKey(), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
    const data = JSON.parse(plain)
    if (!data || typeof data.s !== 'string' || typeof data.e !== 'number') return null
    if (data.e < Date.now()) return null
    if (!assertVaultSrc(data.s)) return null
    return data.s
  } catch {
    return null
  }
}

export function assertVaultSrc(src) {
  if (typeof src !== 'string') return false
  if (src.includes('..') || src.includes('\\') || src.includes('\0')) return false
  // Originals: /media/file.jpg  Thumbs: /media/thumbs/id.webp  Videos/sfx: flat
  if (!/^\/(media|video|sfx)\/(?:thumbs\/)?[A-Za-z0-9._-]+$/.test(src)) return false
  return true
}

export function vaultAbs(src) {
  if (!assertVaultSrc(src)) return null
  const rel = src.replace(/^\//, '')
  const full = path.join(config.vaultDir, rel)
  if (!full.startsWith(config.vaultDir)) return null
  return full
}

export function tokenUrl(src) {
  return `/m/${mintToken(src)}`
}

function mediaRateOk(ip) {
  const now = Date.now()
  const windowMs = 60_000
  const max = 900
  const arr = (mediaHits.get(ip) || []).filter((t) => now - t < windowMs)
  if (arr.length >= max) {
    mediaHits.set(ip, arr)
    return false
  }
  arr.push(now)
  mediaHits.set(ip, arr)
  return true
}

/** Periodic prune of rate maps */
setInterval(() => {
  const now = Date.now()
  for (const [k, arr] of mediaHits) {
    const next = arr.filter((t) => now - t < 60_000)
    if (next.length) mediaHits.set(k, next)
    else mediaHits.delete(k)
  }
}, 5 * 60_000).unref?.()

/**
 * Stream a vault file with Range / 206 support.
 */
export function sendVaultFile(req, res, absPath, { downloadName = null } = {}) {
  const st = fs.statSync(absPath)
  const ext = path.extname(absPath).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const size = st.size
  const range = String(req.headers.range || '')
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
  applyAnonHeaders(res, { https: false })
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', type)
  // Longer private cache — thumbs/stills feel instant on revisit/scroll
  const isThumb = String(absPath || '').includes(`${path.sep}thumbs${path.sep}`)
  res.setHeader(
    'Cache-Control',
    isThumb
      ? 'private, max-age=86400, stale-while-revalidate=3600'
      : 'private, max-age=600, stale-while-revalidate=120',
  )
  res.setHeader('ETag', etag)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Never leak vault filenames in Content-Disposition
  res.setHeader(
    'Content-Disposition',
    downloadName ? `inline; filename="${downloadName}"` : 'inline; filename="m"',
  )
  res.setHeader('Vary', 'Sec-Fetch-Dest')
  // Block naive hotlink / open-as-document when possible
  const dest = String(req.headers['sec-fetch-dest'] || '')
  if (dest === 'document') {
    res.statusCode = 403
    res.end()
    return
  }
  const inm = String(req.headers['if-none-match'] || '')
  if (inm && inm === etag && !range) {
    res.statusCode = 304
    res.end()
    return
  }

  const streamError = (stream) => {
    stream.on('error', () => {
      try {
        if (!res.headersSent) {
          res.statusCode = 500
          res.end()
        } else res.destroy()
      } catch {
        /* ignore */
      }
    })
  }

  if (range.startsWith('bytes=') && req.method !== 'HEAD') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (m) {
      let start = m[1] === '' ? NaN : Number(m[1])
      let end = m[2] === '' ? NaN : Number(m[2])
      if (Number.isNaN(start)) {
        // suffix: bytes=-N
        const suffix = Number.isNaN(end) ? 0 : end
        start = Math.max(0, size - suffix)
        end = size - 1
      } else if (Number.isNaN(end)) {
        end = size - 1
      }
      if (start >= size || end >= size || start > end) {
        res.statusCode = 416
        res.setHeader('Content-Range', `bytes */${size}`)
        res.end()
        return
      }
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', String(end - start + 1))
      const stream = fs.createReadStream(absPath, { start, end })
      streamError(stream)
      stream.pipe(res)
      return
    }
  }

  res.statusCode = 200
  res.setHeader('Content-Length', String(size))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = fs.createReadStream(absPath)
  streamError(stream)
  stream.pipe(res)
}

/** GET /m/:token — opaque media */
export function handleOpaqueMedia(req, res) {
  const url = (req.url || '').split('?')[0]
  if (!url.startsWith('/m/')) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end('method not allowed')
    return true
  }

  const settings = getSettings()
  if (settings.maintenanceMode) {
    sendJson(res, 503, { ok: false, error: 'maintenance' })
    return true
  }

  const ip = clientIp(req)
  if (isBanned(ip)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' })
    return true
  }
  if (!mediaRateOk(ip)) {
    res.statusCode = 429
    res.end()
    return true
  }

  let token
  try {
    token = decodeURIComponent(url.slice(3))
  } catch {
    res.statusCode = 400
    res.end()
    return true
  }
  const src = verifyToken(token)
  if (!src) {
    res.statusCode = 404
    res.end()
    return true
  }
  const abs = vaultAbs(src)
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.statusCode = 404
    res.end()
    return true
  }
  sendVaultFile(req, res, abs)
  return true
}

function opaqueId(src) {
  return createHmac('sha256', mediaKey())
    .update('id:' + src)
    .digest('base64url')
    .slice(0, 22)
}

function looksLikeFilename(t) {
  const s = String(t || '').trim()
  if (!s) return true
  if (/\.(jpe?g|png|gif|webp|webm|mp4|mov|wav|mp3)$/i.test(s)) return true
  if (/^(x_|js-|img_|vid_|dsc|img|file)[a-z0-9_-]*$/i.test(s)) return true
  if (/^[a-f0-9]{8,}$/i.test(s)) return true
  return false
}

function publicTitle(raw, kind) {
  const t = String(raw || '').trim()
  if (looksLikeFilename(t)) return kind === 'video' ? 'TAPE' : 'STILL'
  // Cap length — avoid leaking long path-like strings
  return t.slice(0, 64)
}

function shuffleRows(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function libraryPayload() {
  const catalog = syncCatalogFromDisk()
  const photos = []
  const videos = []
  for (const [src, item] of Object.entries(catalog.items)) {
    if (item.hidden || item.missing) continue
    // Never list generated thumbs as library items
    if (src.includes('/thumbs/')) continue
    const abs = vaultAbs(src)
    if (!abs || !fs.existsSync(abs)) continue
    const isVid = item.kind === 'video' || src.startsWith('/video/')
    const row = {
      id: opaqueId(src),
      url: tokenUrl(src),
      title: publicTitle(item.title || item.label || '', isVid ? 'video' : 'photo'),
      rating: String(item.rating || (isVid ? 'R — tape' : 'R — archive')).slice(0, 48),
      story: String(item.description || '').slice(0, 2000),
      featured: Boolean(item.featured || item.source === 'accepted'),
    }
    if (!isVid) {
      // Prefer prebuilt WebP thumb for collage tiles (same look, far less bytes)
      const tRel = thumbRelForSrc(src)
      if (tRel && hasThumb(src)) row.thumbUrl = tokenUrl(tRel)
    }
    if (isVid) videos.push(row)
    else photos.push(row)
  }
  // Shuffle so catalog/disk enumeration order is not fingerprintable
  shuffleRows(photos)
  shuffleRows(videos)
  // Featured still float early without exposing source field
  photos.sort((a, b) => Number(b.featured) - Number(a.featured))
  videos.sort((a, b) => Number(b.featured) - Number(a.featured))
  return { photos, videos }
}

function bootPayload() {
  const scareSrcs = [...BRUTAL_FACES, ...BRUTAL_FACES, ...LEGACY_SCARES].filter((s) => {
    const abs = vaultAbs(s)
    return abs && fs.existsSync(abs)
  })
  const faces = BRUTAL_FACES.filter((s) => {
    const abs = vaultAbs(s)
    return abs && fs.existsSync(abs)
  }).map(tokenUrl)

  return {
    ok: true,
    scare: scareSrcs.map(tokenUrl),
    faces,
    sfx: collectSfxTokens(),
    flags: publicSiteFlags(),
    ttlMs: TOKEN_TTL_MS,
  }
}

/** Public library + boot APIs (no raw paths). */
export async function handleMediaApi(req, res) {
  const url = (req.url || '').split('?')[0]

  if (url === '/api/boot' && req.method === 'GET') {
    const ip = clientIp(req)
    const gate = apiRateLimit(ip, { max: 120, windowMs: 60_000, bucket: 'boot' })
    if (!gate.ok) {
      res.setHeader('Retry-After', String(gate.retryAfter))
      sendJson(res, 429, { ok: false, error: 'too many requests' })
      return true
    }
    const settings = getSettings()
    if (settings.maintenanceMode) {
      sendJson(res, 200, {
        ok: true,
        maintenance: true,
        message: settings.maintenanceMessage,
        flags: publicSiteFlags(),
        scare: [],
        faces: [],
        sfx: {},
      })
      return true
    }
    sendJson(res, 200, bootPayload())
    return true
  }

  if (url === '/api/library' && req.method === 'GET') {
    const ip = clientIp(req)
    const gate = apiRateLimit(ip, { max: 120, windowMs: 60_000, bucket: 'library' })
    if (!gate.ok) {
      res.setHeader('Retry-After', String(gate.retryAfter))
      sendJson(res, 429, { ok: false, error: 'too many requests' })
      return true
    }
    if (getSettings().maintenanceMode) {
      sendJson(res, 503, { ok: false, error: 'maintenance', ...publicSiteFlags() })
      return true
    }
    if (isBanned(ip)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' })
      return true
    }
    // Tiny jitter — frustrates timing fingerprinting of catalog size
    await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 40)))
    const data = libraryPayload()
    sendJson(res, 200, { ok: true, ...data })
    return true
  }

  return false
}

/** Admin-authenticated vault file by catalog src. */
export function adminVaultFile(src) {
  if (!assertVaultSrc(src)) return null
  const abs = vaultAbs(src)
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null
  return abs
}
