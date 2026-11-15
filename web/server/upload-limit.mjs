/**
 * Public upload API — IP rate limit (5 / 5 min) + description + optional Turnstile.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { clientIp, sendJson, verifyTurnstile, hashIp } from './security.mjs'
import {
  sanitizeDescription,
  validateDescription,
  charCount,
  MAX_DESC_CHARS,
} from './catalog.mjs'
import { getSettings, isBanned } from './settings.mjs'

export const WINDOW_MS = 5 * 60 * 1000
export const MAX_PER_WINDOW = 5
export const MAX_BYTES = 12 * 1024 * 1024

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/webm',
  'video/mp4',
  'video/quicktime',
])

/** @type {Map<string, number[]>} */
const hits = new Map()

function prune(ip, now = Date.now()) {
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  hits.set(ip, arr)
  return arr
}

export function peekLimit(ip, max = MAX_PER_WINDOW) {
  const now = Date.now()
  const arr = prune(ip, now)
  const cap = Math.max(1, Number(max) || MAX_PER_WINDOW)
  const remaining = Math.max(0, cap - arr.length)
  const retryAfter =
    remaining === 0 && arr.length
      ? Math.max(1, Math.ceil((arr[0] + WINDOW_MS - now) / 1000))
      : 0
  return { remaining, retryAfter, used: arr.length }
}

export function claimSlot(ip, max = MAX_PER_WINDOW) {
  const now = Date.now()
  const arr = prune(ip, now)
  const cap = Math.max(1, Number(max) || MAX_PER_WINDOW)
  if (arr.length >= cap) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((arr[0] + WINDOW_MS - now) / 1000)),
    }
  }
  arr.push(now)
  hits.set(ip, arr)
  return { ok: true, remaining: cap - arr.length, retryAfter: 0 }
}

export function sanitizeName(name) {
  return String(name || 'upload')
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .slice(0, 120)
}

export function validateMeta(type, size, name) {
  if (!ALLOWED.has(type)) return 'only jpg/png/webp/gif/webm/mp4'
  if (!size || size <= 0 || size > MAX_BYTES) return 'max 12MB'
  if (/\.(html?|svg|js|mjs|css|exe|php|sh)$/i.test(name || '')) return 'blocked type'
  return null
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        reject(Object.assign(new Error('too large'), { code: 'LIMIT' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * @param {{ pendingDir: string }} opts
 */
export function createUploadMiddleware(opts) {
  const pendingDir = opts.pendingDir
  fs.mkdirSync(pendingDir, { recursive: true })

  return async function uploadMiddleware(req, res, next) {
    const url = req.url?.split('?')[0] || ''
    if (!url.startsWith('/api/upload')) return next?.()

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Filename, X-File-Type, X-Description, X-Turnstile-Token',
      )
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Max-Age', '600')
      res.end()
      return
    }

    const ip = clientIp(req)
    const settings = getSettings()
    const limitCap = Number(settings.maxUploadsPerWindow) || MAX_PER_WINDOW

    if (req.method === 'GET' && (url === '/api/upload/status' || url === '/api/upload')) {
      const s = peekLimit(ip, limitCap)
      sendJson(res, 200, {
        ok: true,
        limit: limitCap,
        windowSec: WINDOW_MS / 1000,
        remaining: settings.uploadsEnabled && !isBanned(ip) ? s.remaining : 0,
        retryAfter: s.retryAfter,
        maxDescChars: MAX_DESC_CHARS,
        uploadsEnabled: settings.uploadsEnabled,
        banned: isBanned(ip),
      })
      return
    }

    if (req.method !== 'POST' || url !== '/api/upload') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }

    if (!settings.uploadsEnabled) {
      sendJson(res, 403, { ok: false, error: 'uploads disabled' })
      return
    }
    if (isBanned(ip)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' })
      return
    }

    const name = sanitizeName(req.headers['x-filename'] || 'upload.bin')
    const type = String(req.headers['x-file-type'] || req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase()

    let description = ''
    try {
      description = decodeURIComponent(String(req.headers['x-description'] || ''))
    } catch {
      description = String(req.headers['x-description'] || '')
    }
    description = sanitizeDescription(description, MAX_DESC_CHARS)
    const descErr = validateDescription(description, MAX_DESC_CHARS)
    if (descErr) {
      sendJson(res, 400, { ok: false, error: descErr })
      return
    }

    const pre = peekLimit(ip, limitCap)
    if (pre.remaining <= 0) {
      res.setHeader('Retry-After', String(pre.retryAfter))
      sendJson(res, 429, {
        ok: false,
        error: 'rate limit — 5 uploads per 5 minutes',
        remaining: 0,
        retryAfter: pre.retryAfter,
        limit: MAX_PER_WINDOW,
        windowSec: WINDOW_MS / 1000,
      })
      return
    }

    const turnstileToken = String(req.headers['x-turnstile-token'] || '')
    const ts = await verifyTurnstile(turnstileToken, ip)
    if (!ts.ok) {
      sendJson(res, 403, { ok: false, error: ts.error || 'bot check failed' })
      return
    }

    let body
    try {
      body = await readRawBody(req, MAX_BYTES)
    } catch (e) {
      if (e && e.code === 'LIMIT') {
        sendJson(res, 413, { ok: false, error: 'max 12MB' })
        return
      }
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return
    }

    const err = validateMeta(type, body.length, name)
    if (err) {
      sendJson(res, 400, { ok: false, error: err })
      return
    }

    const slot = claimSlot(ip, limitCap)
    if (!slot.ok) {
      res.setHeader('Retry-After', String(slot.retryAfter))
      sendJson(res, 429, {
        ok: false,
        error: 'rate limit — 5 uploads per 5 minutes',
        remaining: 0,
        retryAfter: slot.retryAfter,
        limit: MAX_PER_WINDOW,
        windowSec: WINDOW_MS / 1000,
      })
      return
    }

    const id = `p_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
    const safe = `${id}__${name}`
    const dest = path.join(pendingDir, safe)
    try {
      fs.writeFileSync(dest, body)
      fs.writeFileSync(
        dest + '.json',
        JSON.stringify(
          {
            id,
            name,
            type,
            size: body.length,
            description,
            descriptionChars: charCount(description),
            // Admin-only fields — never returned on public upload response
            ip,
            ipHash: hashIp(ip),
            created: Date.now(),
            status: 'pending',
          },
          null,
          2,
        ),
      )
    } catch {
      sendJson(res, 500, { ok: false, error: 'store failed' })
      return
    }

    // Anonymous client response — no IP, no storage path
    sendJson(res, 200, {
      ok: true,
      id,
      remaining: slot.remaining,
      limit: MAX_PER_WINDOW,
      windowSec: WINDOW_MS / 1000,
    })
  }
}
