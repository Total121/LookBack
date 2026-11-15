import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import {
  clientIp,
  sendJson,
  getSession,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  verifyAdminCredentials,
  loginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  requireCsrf,
  verifyTurnstile,
  readJsonBody,
  publicConfig,
  setSecurityHeaders,
} from './security.mjs'
import {
  listPending,
  findPending,
  pendingFilePath,
  acceptPending,
  denyPending,
  adminLibraryView,
  updateCatalogItem,
  deleteCatalogItem,
  validateDescription,
  sanitizeDescription,
  syncCatalogFromDisk,
  rebuildMediaIndexes,
  setItemHidden,
  setItemFeatured,
  MAX_DESC_CHARS,
  loadCatalog,
} from './catalog.mjs'
import { adminVaultFile, sendVaultFile } from './media-token.mjs'
import {
  getSettings,
  patchSettings,
  getBans,
  banIp,
  unbanIp,
  readAudit,
  publicSiteFlags,
  audit,
} from './settings.mjs'
import { listReactions, getReaction, deleteReaction, purgeOldReactions, reactionsDir } from './reactions.mjs'

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

function requireAdmin(req, res) {
  const session = getSession(req)
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return null
  }
  return session
}

function requireAdminMutate(req, res) {
  const session = requireAdmin(req, res)
  if (!session) return null
  if (req.method !== 'GET' && req.method !== 'HEAD' && !requireCsrf(req, session)) {
    sendJson(res, 403, { ok: false, error: 'invalid csrf' })
    return null
  }
  return session
}

/**
 * Handle /api/admin/* and related. Returns true if handled.
 */
export async function handleAdminApi(req, res) {
  const url = (req.url || '').split('?')[0]

  if (url === '/api/public/config' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, ...publicConfig(), ...publicSiteFlags() })
    return true
  }

  // Legacy path catalog removed — use /api/library (opaque tokens only)
  if (url === '/api/public/catalog' && req.method === 'GET') {
    sendJson(res, 410, {
      ok: false,
      error: 'gone',
      message: 'use /api/library',
    })
    return true
  }

  if (!url.startsWith('/api/admin')) return false

  setSecurityHeaders(res, { admin: true, req })

  // —— auth ——
  if (url === '/api/admin/login' && req.method === 'POST') {
    const ip = clientIp(req)
    const gate = loginAllowed(ip)
    if (!gate.ok) {
      res.setHeader('Retry-After', String(gate.retryAfter))
      sendJson(res, 429, {
        ok: false,
        error: 'too many login attempts',
        retryAfter: gate.retryAfter,
      })
      return true
    }

    let body
    try {
      body = await readJsonBody(req, 32_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }

    const ts = await verifyTurnstile(String(body.turnstileToken || ''), ip)
    if (!ts.ok) {
      recordLoginFailure(ip)
      sendJson(res, 403, { ok: false, error: ts.error || 'bot check failed' })
      return true
    }

    const username = String(body.username || '')
    const password = String(body.password || '')
    // constant-time-ish delay
    const start = Date.now()
    const ok = verifyAdminCredentials(username, password)
    const wait = 350 - (Date.now() - start)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))

    if (!ok) {
      recordLoginFailure(ip)
      sendJson(res, 401, { ok: false, error: 'invalid credentials' })
      return true
    }

    clearLoginFailures(ip)
    destroySession(req)
    const session = createSession(username, ip)
    setSessionCookie(res, req, session.id)
    sendJson(res, 200, {
      ok: true,
      user: username,
      csrf: session.csrf,
      config: publicConfig(),
    })
    return true
  }

  if (url === '/api/admin/logout' && req.method === 'POST') {
    const session = getSession(req)
    if (session && !requireCsrf(req, session)) {
      sendJson(res, 403, { ok: false, error: 'invalid csrf' })
      return true
    }
    destroySession(req)
    clearSessionCookie(res, req)
    sendJson(res, 200, { ok: true })
    return true
  }

  if (url === '/api/admin/session' && req.method === 'GET') {
    const session = getSession(req)
    if (!session) {
      sendJson(res, 401, { ok: false, authenticated: false, config: publicConfig() })
      return true
    }
    sendJson(res, 200, {
      ok: true,
      authenticated: true,
      user: session.user,
      csrf: session.csrf,
      config: publicConfig(),
    })
    return true
  }

  // —— pending ——
  if (url === '/api/admin/pending' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    sendJson(res, 200, { ok: true, items: listPending() })
    return true
  }

  const pendingFileMatch = url.match(/^\/api\/admin\/pending\/([^/]+)\/file$/)
  if (pendingFileMatch && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    const id = decodeURIComponent(pendingFileMatch[1])
    const meta = findPending(id)
    if (!meta) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return true
    }
    const filePath = pendingFilePath(meta)
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { ok: false, error: 'file missing' })
      return true
    }
    const ext = path.extname(meta.name || filePath).toLowerCase()
    res.statusCode = 200
    res.setHeader('Content-Type', meta.type || MIME[ext] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    fs.createReadStream(filePath).pipe(res)
    return true
  }

  const pendingAction = url.match(/^\/api\/admin\/pending\/([^/]+)\/(accept|deny)$/)
  if (pendingAction && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    const id = decodeURIComponent(pendingAction[1])
    const action = pendingAction[2]
    const meta = findPending(id)
    if (!meta) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return true
    }

    if (action === 'deny') {
      denyPending(meta)
      sendJson(res, 200, { ok: true, denied: id })
      return true
    }

    let body = {}
    try {
      body = await readJsonBody(req, 64_000)
    } catch {
      body = {}
    }
    const description = sanitizeDescription(
      body.description != null ? body.description : meta.description || '',
      MAX_DESC_CHARS,
    )
    const descErr = validateDescription(description, MAX_DESC_CHARS)
    if (descErr) {
      sendJson(res, 400, { ok: false, error: descErr })
      return true
    }
    const title =
      body.title != null ? String(body.title).trim().slice(0, 160) : meta.name || id
    const rating =
      body.rating != null ? String(body.rating).trim().slice(0, 80) : 'R — community submit'

    try {
      const result = acceptPending(meta, pendingFilePath(meta), {
        title,
        description,
        rating,
      })
      sendJson(res, 200, { ok: true, accepted: result })
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : 'accept failed',
      })
    }
    return true
  }

  // —— library ——
  if (url === '/api/admin/library' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    const items = adminLibraryView().map((item) => ({
      ...item,
      previewUrl: `/api/admin/library/file?src=${encodeURIComponent(item.src)}`,
    }))
    sendJson(res, 200, { ok: true, items })
    return true
  }

  if (url === '/api/admin/library' && req.method === 'PATCH') {
    if (!requireAdminMutate(req, res)) return true
    let body
    try {
      body = await readJsonBody(req, 64_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }
    const src = String(body.src || '')
    if (!src.startsWith('/media/') && !src.startsWith('/video/')) {
      sendJson(res, 400, { ok: false, error: 'invalid src' })
      return true
    }
    if (body.description != null) {
      const cleaned = sanitizeDescription(body.description, MAX_DESC_CHARS)
      const err = validateDescription(cleaned, MAX_DESC_CHARS, {
        required: Boolean(String(body.description).trim()),
      })
      if (err) {
        sendJson(res, 400, { ok: false, error: err })
        return true
      }
    }
    const updated = updateCatalogItem(src, {
      title: body.title,
      description: body.description,
      rating: body.rating,
    })
    if (!updated) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return true
    }
    sendJson(res, 200, { ok: true, item: updated })
    return true
  }

  if (url === '/api/admin/library' && req.method === 'DELETE') {
    if (!requireAdminMutate(req, res)) return true
    let body
    try {
      body = await readJsonBody(req, 16_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }
    const src = String(body.src || '')
    const result = deleteCatalogItem(src)
    if (!result.ok) {
      sendJson(res, 400, { ok: false, error: result.error || 'delete failed' })
      return true
    }
    if (!result.deleted) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return true
    }
    sendJson(res, 200, {
      ok: true,
      deleted: src,
      removedFiles: result.removedFiles,
      stats: result.stats,
    })
    return true
  }

  if (url === '/api/admin/reindex' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    const stats = rebuildMediaIndexes()
    syncCatalogFromDisk()
    audit('reindex', stats)
    sendJson(res, 200, { ok: true, stats })
    return true
  }

  if (url === '/api/admin/stats' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    const pending = listPending()
    const library = adminLibraryView()
    const reactions = listReactions()
    sendJson(res, 200, {
      ok: true,
      pending: pending.length,
      library: library.length,
      photos: library.filter((i) => i.kind === 'photo').length,
      videos: library.filter((i) => i.kind === 'video').length,
      accepted: library.filter((i) => i.source === 'accepted').length,
      reactions: reactions.length,
      banned: getBans().length,
      uploadsEnabled: getSettings().uploadsEnabled,
      reactionsEnabled: getSettings().reactionsEnabled,
      maintenanceMode: getSettings().maintenanceMode,
    })
    return true
  }

  // —— settings / ops ——
  if (url === '/api/admin/settings' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    sendJson(res, 200, { ok: true, settings: getSettings() })
    return true
  }

  if (url === '/api/admin/settings' && req.method === 'PATCH') {
    if (!requireAdminMutate(req, res)) return true
    let body
    try {
      body = await readJsonBody(req, 32_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }
    sendJson(res, 200, { ok: true, settings: patchSettings(body) })
    return true
  }

  if (url === '/api/admin/bans' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    sendJson(res, 200, { ok: true, items: getBans() })
    return true
  }

  if (url === '/api/admin/bans' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    let body
    try {
      body = await readJsonBody(req, 16_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }
    const ip = String(body.ip || '').trim()
    if (!ip) {
      sendJson(res, 400, { ok: false, error: 'ip required' })
      return true
    }
    sendJson(res, 200, { ok: true, item: banIp(ip, body.reason || '') })
    return true
  }

  if (url === '/api/admin/bans' && req.method === 'DELETE') {
    if (!requireAdminMutate(req, res)) return true
    let body
    try {
      body = await readJsonBody(req, 16_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }
    unbanIp(String(body.ip || ''))
    sendJson(res, 200, { ok: true })
    return true
  }

  if (url === '/api/admin/audit' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    sendJson(res, 200, { ok: true, items: readAudit(150) })
    return true
  }

  if (url === '/api/admin/reactions' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    sendJson(res, 200, { ok: true, items: listReactions() })
    return true
  }

  const reactionFile = url.match(/^\/api\/admin\/reactions\/([^/]+)\/file$/)
  if (reactionFile && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    const id = decodeURIComponent(reactionFile[1])
    const meta = getReaction(id)
    if (!meta) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return true
    }
    const filePath = path.join(reactionsDir, meta.file)
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { ok: false, error: 'file missing' })
      return true
    }
    res.statusCode = 200
    res.setHeader('Content-Type', meta.type || 'video/webm')
    res.setHeader('Cache-Control', 'no-store')
    fs.createReadStream(filePath).pipe(res)
    return true
  }

  if (url === '/api/admin/reactions' && req.method === 'DELETE') {
    if (!requireAdminMutate(req, res)) return true
    let body
    try {
      body = await readJsonBody(req, 16_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }
    const ok = deleteReaction(String(body.id || ''))
    sendJson(res, ok ? 200 : 404, { ok })
    return true
  }

  if (url === '/api/admin/reactions/purge' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    sendJson(res, 200, { ok: true, removed: purgeOldReactions() })
    return true
  }

  if (url === '/api/admin/pending/purge' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    let body = {}
    try {
      body = await readJsonBody(req, 8_000)
    } catch {
      body = {}
    }
    const olderThanDays = Number(body.olderThanDays)
    const cut =
      Number.isFinite(olderThanDays) && olderThanDays > 0
        ? Date.now() - olderThanDays * 86400000
        : null
    let removed = 0
    for (const p of listPending()) {
      if (cut != null && (p.created || 0) > cut) continue
      denyPending(p)
      removed++
    }
    audit('pending.purge', { removed, olderThanDays: olderThanDays || 'all' })
    sendJson(res, 200, { ok: true, removed })
    return true
  }

  if (url === '/api/admin/library/export' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    const catalog = loadCatalog()
    sendJson(res, 200, { ok: true, catalog })
    return true
  }

  if (url === '/api/admin/library/hide' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    let body
    try {
      body = await readJsonBody(req, 16_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }
    const item = setItemHidden(String(body.src || ''), Boolean(body.hidden))
    if (!item) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return true
    }
    sendJson(res, 200, { ok: true, item })
    return true
  }

  if (url === '/api/admin/library/feature' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    let body
    try {
      body = await readJsonBody(req, 16_000)
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad body' })
      return true
    }
    const item = setItemFeatured(String(body.src || ''), Boolean(body.featured))
    if (!item) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return true
    }
    sendJson(res, 200, { ok: true, item })
    return true
  }

  if (url === '/api/admin/library/file' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    const q = new URL(req.url || '/', 'http://local')
    const src = q.searchParams.get('src') || ''
    const abs = adminVaultFile(src)
    if (!abs) {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return true
    }
    sendVaultFile(req, res, abs)
    return true
  }

  if (url === '/api/admin/health' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true
    const mediaDir = path.join(config.vaultDir, 'media')
    const videoDir = path.join(config.vaultDir, 'video')
    const mediaCount = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).length : 0
    const videoCount = fs.existsSync(videoDir) ? fs.readdirSync(videoDir).length : 0
    const pendingCount = listPending().length
    const reactionCount = listReactions().length
    sendJson(res, 200, {
      ok: true,
      health: {
        mediaCount,
        videoCount,
        pendingCount,
        reactionCount,
        bans: getBans().length,
        catalogItems: Object.keys(syncCatalogFromDisk().items).length,
        vault: true,
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
    })
    return true
  }

  if (url === '/api/admin/ops/toggle-uploads' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    const s = getSettings()
    sendJson(res, 200, { ok: true, settings: patchSettings({ uploadsEnabled: !s.uploadsEnabled }) })
    return true
  }

  if (url === '/api/admin/ops/toggle-reactions' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    const s = getSettings()
    sendJson(res, 200, {
      ok: true,
      settings: patchSettings({ reactionsEnabled: !s.reactionsEnabled }),
    })
    return true
  }

  if (url === '/api/admin/ops/toggle-maintenance' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    const s = getSettings()
    sendJson(res, 200, {
      ok: true,
      settings: patchSettings({ maintenanceMode: !s.maintenanceMode }),
    })
    return true
  }

  if (url === '/api/admin/ops/toggle-ambient' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    const s = getSettings()
    sendJson(res, 200, { ok: true, settings: patchSettings({ ambientHaunt: !s.ambientHaunt }) })
    return true
  }

  if (url === '/api/admin/library/purge-accepted' && req.method === 'POST') {
    if (!requireAdminMutate(req, res)) return true
    const library = adminLibraryView().filter((i) => i.source === 'accepted')
    let removed = 0
    for (const item of library) {
      const r = deleteCatalogItem(item.src)
      if (r.ok && r.deleted) removed++
    }
    audit('library.purgeAccepted', { removed })
    sendJson(res, 200, { ok: true, removed })
    return true
  }

  sendJson(res, 404, { ok: false, error: 'not found' })
  return true
}

/** Serve /alb admin UI (obscured path). Never linked from public site. */
export function handleAdminUi(req, res) {
  const url = (req.url || '').split('?')[0]
  if (url !== '/alb' && !url.startsWith('/alb/')) return false

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end('method not allowed')
    return true
  }

  setSecurityHeaders(res, { admin: true, req })
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')

  let rel = url === '/alb' || url === '/alb/' ? '/index.html' : url.slice('/alb'.length)
  if (rel.includes('..')) {
    res.statusCode = 400
    res.end('bad path')
    return true
  }

  // Prefer obfuscated admin bundle in production builds
  if (rel === '/admin.js') {
    const obf = path.join(config.adminUiDir, 'admin.obf.js')
    if (fs.existsSync(obf)) rel = '/admin.obf.js'
  }

  const filePath = path.normalize(path.join(config.adminUiDir, rel))
  const adminBase = config.adminUiDir.endsWith(path.sep)
    ? config.adminUiDir
    : config.adminUiDir + path.sep
  if (filePath !== config.adminUiDir && !filePath.startsWith(adminBase)) {
    res.statusCode = 400
    res.end('bad path')
    return true
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // SPA-ish: always index for unknown /alb routes
    const index = path.join(config.adminUiDir, 'index.html')
    if (fs.existsSync(index)) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (req.method === 'HEAD') {
        res.end()
        return true
      }
      fs.createReadStream(index).pipe(res)
      return true
    }
    res.statusCode = 404
    res.end('not found')
    return true
  }

  const ext = path.extname(filePath).toLowerCase()
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  }
  res.statusCode = 200
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  fs.createReadStream(filePath).pipe(res)
  return true
}
