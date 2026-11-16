import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { config } from './config.mjs'

/** @type {Map<string, { user: string, csrf: string, expires: number, ip: string }>} */
const sessions = new Map()

/** @type {Map<string, number[]>} */
const loginHits = new Map()
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX = 5

export function clientIp(req) {
  if (config.trustProxy) {
    // Prefer Cloudflare's verified connecting IP when present
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf.trim()) return cf.trim().slice(0, 64)
    // Single trusted proxy (Render/CF): leftmost XFF is the client
    const xf = req.headers['x-forwarded-for']
    if (typeof xf === 'string' && xf.trim()) {
      const parts = xf.split(',').map((s) => s.trim()).filter(Boolean)
      if (parts.length) return parts[0].slice(0, 64)
    }
    const real = req.headers['x-real-ip']
    if (typeof real === 'string' && real.trim()) return real.trim().slice(0, 64)
  }
  return req.socket?.remoteAddress || 'unknown'
}

export function sendJson(res, status, body) {
  const raw = JSON.stringify(body)
  res.statusCode = status
  applyAnonHeaders(res)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.setHeader('Pragma', 'no-cache')
  res.end(raw)
}

/** Hard anonymity + browser hardening for every response. */
export function applyAnonHeaders(res, { admin = false, https = false } = {}) {
  res.removeHeader('X-Powered-By')
  res.removeHeader('Server')
  res.removeHeader('X-AspNet-Version')
  res.removeHeader('X-AspNetMvc-Version')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(self), display-capture=(), geolocation=(), gyroscope=(), interest-cohort=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()',
  )
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('X-Download-Options', 'noopen')
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  res.setHeader('Origin-Agent-Cluster', '?1')
  if (https) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
  if (admin) {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "media-src 'self' blob:",
        "connect-src 'self' https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "font-src 'self'",
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join('; '),
    )
  }
}

export function setSecurityHeaders(res, { admin = false, req = null } = {}) {
  const https = req ? isHttps(req) : false
  applyAnonHeaders(res, { admin, https })
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
  return proto === 'https' || req.socket?.encrypted === true
}

/** Per-bucket per-IP throttle (library/boot must not share a tiny counter with everything). */
const apiBuckets = new Map()
export function apiRateLimit(ip, { max = 120, windowMs = 60_000, bucket = 'api' } = {}) {
  const now = Date.now()
  const key = `${bucket}:${ip}`
  const arr = (apiBuckets.get(key) || []).filter((t) => now - t < windowMs)
  if (arr.length >= max) {
    apiBuckets.set(key, arr)
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)),
    }
  }
  arr.push(now)
  apiBuckets.set(key, arr)
  return { ok: true, retryAfter: 0 }
}

function parseCookies(req) {
  const raw = req.headers.cookie || ''
  /** @type {Record<string, string>} */
  const out = {}
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

function sign(value) {
  const sig = createHmac('sha256', config.sessionSecret).update(value).digest('base64url')
  return `${value}.${sig}`
}

function unsign(signed) {
  if (!signed || typeof signed !== 'string') return null
  const i = signed.lastIndexOf('.')
  if (i < 1) return null
  const value = signed.slice(0, i)
  const sig = signed.slice(i + 1)
  const expect = createHmac('sha256', config.sessionSecret).update(value).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return value
}

function passwordDigest(password) {
  // salted via SESSION_SECRET so stolen .env password alone isn't enough without secret
  return scryptSync(String(password), 'lb:' + config.sessionSecret, 64)
}

export function verifyAdminCredentials(username, password) {
  if (!config.adminUsername || !config.adminPassword || !config.sessionSecret) return false
  const uOk =
    username.length === config.adminUsername.length &&
    timingSafeEqual(Buffer.from(username), Buffer.from(config.adminUsername))
  const a = passwordDigest(password)
  const b = passwordDigest(config.adminPassword)
  const pOk = a.length === b.length && timingSafeEqual(a, b)
  return uOk && pOk
}

export function loginAllowed(ip) {
  const now = Date.now()
  const arr = (loginHits.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS)
  loginHits.set(ip, arr)
  if (arr.length >= LOGIN_MAX) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((arr[0] + LOGIN_WINDOW_MS - now) / 1000)),
    }
  }
  return { ok: true, retryAfter: 0 }
}

export function recordLoginFailure(ip) {
  const now = Date.now()
  const arr = (loginHits.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS)
  arr.push(now)
  loginHits.set(ip, arr)
}

export function clearLoginFailures(ip) {
  loginHits.delete(ip)
}

function pruneSessions() {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (s.expires < now) sessions.delete(id)
  }
}

export function createSession(user, ip) {
  pruneSessions()
  const id = randomBytes(32).toString('base64url')
  const csrf = randomBytes(24).toString('base64url')
  sessions.set(id, {
    user,
    csrf,
    ip,
    expires: Date.now() + config.sessionTtlMs,
  })
  return { id, csrf }
}

export function destroySession(req) {
  const cookies = parseCookies(req)
  const raw = readSessionRaw(cookies)
  const id = unsign(raw)
  if (id) sessions.delete(id)
}

export function getSession(req) {
  pruneSessions()
  const cookies = parseCookies(req)
  const raw = readSessionRaw(cookies)
  const id = unsign(raw)
  if (!id) return null
  const s = sessions.get(id)
  if (!s) return null
  if (s.expires < Date.now()) {
    sessions.delete(id)
    return null
  }
  return { id, ...s }
}

function cookieTag() {
  // Stable anonymous cookie name derived from secret — no product brand in DevTools
  return createHmac('sha256', config.sessionSecret || 'x')
    .update('cookie-tag-v1')
    .digest('base64url')
    .slice(0, 8)
}

function cookieName(secure) {
  const tag = cookieTag()
  // __Host- requires Secure + Path=/ + no Domain — stronger against subdomain theft
  return secure ? `__Host-${tag}` : tag
}

function readSessionRaw(cookies) {
  const tag = cookieTag()
  return (
    cookies[`__Host-${tag}`] ||
    cookies[tag] ||
    // legacy names (migrate silently)
    cookies['__Host-lb_admin'] ||
    cookies.lb_admin ||
    ''
  )
}

export function setSessionCookie(res, req, sessionId) {
  const signed = sign(sessionId)
  const secure = cookieSecureFrom(req)
  const parts = [
    `${cookieName(secure)}=${encodeURIComponent(signed)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`,
  ]
  if (secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearSessionCookie(res, req) {
  const secure = cookieSecureFrom(req)
  const tag = cookieTag()
  const expire = (name, withSecure) => {
    const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
    if (withSecure) parts.push('Secure')
    return parts.join('; ')
  }
  res.setHeader('Set-Cookie', [
    expire(tag, secure),
    expire(`__Host-${tag}`, true),
    expire('lb_admin', secure),
    expire('__Host-lb_admin', true),
  ])
  res.setHeader('Clear-Site-Data', '"cookies", "storage"')
}

function cookieSecureFrom(req) {
  if (config.cookieSecure === 'true') return true
  if (config.cookieSecure === 'false') return false
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
  return proto === 'https' || req.socket?.encrypted === true
}

export function requireCsrf(req, session) {
  const token = String(req.headers['x-csrf-token'] || '')
  if (!session?.csrf || !token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(session.csrf)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function verifyTurnstile(token, ip) {
  if (!config.requireTurnstile) return { ok: true, skipped: true }
  if (!config.turnstileSecretKey) return { ok: false, error: 'turnstile not configured' }
  if (!token || typeof token !== 'string') return { ok: false, error: 'missing turnstile token' }

  const body = new URLSearchParams()
  body.set('secret', config.turnstileSecretKey)
  body.set('response', token)
  if (ip && ip !== 'unknown') body.set('remoteip', ip)

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await res.json()
    if (!data.success) {
      return { ok: false, error: 'turnstile failed', codes: data['error-codes'] || [] }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'turnstile unreachable' }
  }
}

export function publicConfig() {
  return {
    turnstileSiteKey: config.turnstileSiteKey || null,
    requireTurnstile: Boolean(config.requireTurnstile && config.turnstileSiteKey),
    maxDescChars: 2000,
  }
}

// lazy import avoided — site flags merged in admin-api / app

export function hashIp(ip) {
  // Peppered HMAC — full hex; raw IPs stay server-side only
  const pepper = createHmac('sha256', config.sessionSecret || 'lb')
    .update('ip-pepper-v2')
    .digest()
  return createHmac('sha256', pepper)
    .update('ip:' + String(ip))
    .digest('hex')
}

export function readJsonBody(req, limit = 1_000_000) {
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
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(Object.assign(new Error('bad json'), { code: 'JSON' }))
      }
    })
    req.on('error', reject)
  })
}

export { parseCookies, sign, unsign }
