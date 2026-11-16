import fs from 'node:fs'
import path from 'node:path'
import { config, assertSecureConfig } from './config.mjs'
import { createUploadMiddleware } from './upload-limit.mjs'
import { handleAdminApi, handleAdminUi } from './admin-api.mjs'
import { setSecurityHeaders, clientIp, apiRateLimit, sendJson, applyAnonHeaders } from './security.mjs'
import { syncCatalogFromDisk, migratePublicToVault, rebuildMediaIndexes } from './catalog.mjs'
import { handlePublicReactions } from './reactions.mjs'
import { getSettings, isBanned } from './settings.mjs'
import { handleOpaqueMedia, handleMediaApi, vaultAbs } from './media-token.mjs'
import { hydrateFromSeed } from './persist.mjs'
import { ensureAllThumbs } from './thumbs.mjs'

export { vaultAbs, ensureAllThumbs, hydrateFromSeed }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function safeJoin(base, reqPath) {
  let decoded
  try {
    decoded = decodeURIComponent(reqPath.split('?')[0])
  } catch {
    return null
  }
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const full = path.join(base, cleaned)
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep
  if (full !== base && !full.startsWith(baseWithSep)) return null
  return full
}

function sendFile(res, filePath, { cache } = {}) {
  const ext = path.extname(filePath).toLowerCase()
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  if (cache === 'immutable') {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  } else if (cache === 'short') {
    res.setHeader('Cache-Control', 'public, max-age=60')
  } else if (cache === 'none') {
    res.setHeader('Cache-Control', 'no-store')
  } else {
    res.setHeader('Cache-Control', 'public, max-age=86400')
  }
  const stream = fs.createReadStream(filePath)
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
  stream.pipe(res)
}

function blockDirectAsset(pathname) {
  return (
    pathname.startsWith('/media/') ||
    pathname.startsWith('/video/') ||
    pathname.startsWith('/sfx/') ||
    pathname === '/media-index.json' ||
    pathname === '/video-index.json' ||
    pathname.startsWith('/vault/') ||
    pathname.startsWith('/data/') ||
    pathname.startsWith('/pending-uploads/') ||
    pathname.startsWith('/server/')
  )
}

/**
 * Shared request handler for production server and Vite middleware.
 * @returns {(req: any, res: any, next?: Function) => Promise<void>}
 */
export function createAppHandler({ isProd = false } = {}) {
  assertSecureConfig(isProd)
  if (isProd) {
    try {
      hydrateFromSeed()
    } catch (err) {
      console.warn('[persist] hydrate failed', err?.message || err)
    }
  }
  migratePublicToVault()
  syncCatalogFromDisk()
  rebuildMediaIndexes()

  // Background thumbs only in production boot — never during Vite plugin load
  if (isProd) {
    void ensureAllThumbs(vaultAbs).catch(() => {})
  }

  const upload = createUploadMiddleware({ pendingDir: config.pendingDir })

  return async function appHandler(req, res, next) {
    const url = req.url || '/'
    const pathname = url.split('?')[0]
    const method = String(req.method || 'GET').toUpperCase()

    try {
      if (method === 'TRACE' || method === 'TRACK') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }

      setSecurityHeaders(res, { req })
      const adminBase = config.adminPath
      // Public CSP as HTTP header (meta alone cannot set frame-ancestors)
      if (!pathname.startsWith(adminBase) && !pathname.startsWith('/api/admin')) {
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

      // Global anonymous API throttle (library/boot use their own higher buckets)
      if (pathname.startsWith('/api/')) {
        const ip = clientIp(req)
        const isEssential = pathname === '/api/library' || pathname === '/api/boot' || pathname === '/api/public/config'
        const gate = apiRateLimit(ip, {
          max: isEssential ? 240 : 240,
          windowMs: 60_000,
          bucket: isEssential ? 'essential' : 'api',
        })
        if (!gate.ok) {
          res.setHeader('Retry-After', String(gate.retryAfter))
          sendJson(res, 429, { ok: false, error: 'too many requests' })
          return
        }
      }

      // Opaque media first
      if (handleOpaqueMedia(req, res)) return
      if (await handleMediaApi(req, res)) return

      if (await handleAdminApi(req, res)) return
      if (handleAdminUi(req, res)) return
      if (await handlePublicReactions(req, res)) return

      // Maintenance: block uploads + public APIs already handled; block site assets except boot
      const settings = getSettings()
      if (settings.maintenanceMode && pathname.startsWith('/api/upload')) {
        sendJson(res, 503, { ok: false, error: 'maintenance', message: settings.maintenanceMessage })
        return
      }

      if (pathname.startsWith('/api/upload')) {
        const ip = clientIp(req)
        if (isBanned(ip)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        await upload(req, res, () => {
          res.statusCode = 404
          res.end('not found')
        })
        return
      }

      // Never expose vault paths or legacy public media indexes
      if (blockDirectAsset(pathname)) {
        applyAnonHeaders(res)
        res.statusCode = 404
        res.end('not found')
        return
      }

      // In Vite middleware mode, let Vite serve the SPA (but assets already blocked above)
      if (!isProd && typeof next === 'function') {
        next()
        return
      }

      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }

      let filePath = safeJoin(config.distDir, pathname === '/' ? '/index.html' : pathname)
      if (!filePath) {
        res.statusCode = 400
        res.end('bad path')
        return
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html')
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        const index = path.join(config.distDir, 'index.html')
        if (fs.existsSync(index)) {
          res.statusCode = 200
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          sendFile(res, index, { cache: 'none' })
          return
        }
        res.statusCode = 404
        res.end('not found')
        return
      }

      res.statusCode = 200
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      sendFile(res, filePath, {
        cache: ext === '.html' ? 'none' : ext === '.js' || ext === '.css' ? 'immutable' : 'default',
      })
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500
        res.end()
      }
    }
  }
}

export { config }
