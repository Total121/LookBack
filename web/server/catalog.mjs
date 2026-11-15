import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { config } from './config.mjs'
import { audit } from './settings.mjs'

/**
 * @typedef {{
 *   title: string,
 *   description: string,
 *   rating: string,
 *   kind: 'photo' | 'video',
 *   source: 'seed' | 'accepted',
 *   featured?: boolean,
 *   hidden?: boolean,
 *   missing?: boolean,
 *   uploaderIp: string | null,
 *   uploaderIpHash?: string | null,
 *   uploadedAt: number | null,
 *   updatedAt: number,
 *   acceptedAt?: number | null,
 *   originalName?: string | null
 * }} CatalogItem
 */

function emptyCatalog() {
  return { version: 1, updatedAt: Date.now(), items: /** @type {Record<string, CatalogItem>} */ ({}) }
}

function readCatalogFile() {
  if (!fs.existsSync(config.catalogPath)) return emptyCatalog()
  try {
    const raw = JSON.parse(fs.readFileSync(config.catalogPath, 'utf8'))
    if (!raw || typeof raw !== 'object' || !raw.items) return emptyCatalog()
    return raw
  } catch {
    return emptyCatalog()
  }
}

function writeCatalogFile(catalog) {
  catalog.updatedAt = Date.now()
  const tmp = config.catalogPath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2))
  fs.renameSync(tmp, config.catalogPath)
}

export function loadCatalog() {
  return readCatalogFile()
}

export function saveCatalog(catalog) {
  writeCatalogFile(catalog)
}

export const MAX_DESC_CHARS = 2000

export function charCount(text) {
  return Array.from(String(text || '')).length
}

/** @deprecated use charCount — kept for older pending metadata */
export function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

export function sanitizeDescription(text, maxChars = MAX_DESC_CHARS) {
  let s = String(text || '')
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  const chars = Array.from(s)
  if (chars.length > maxChars) s = chars.slice(0, maxChars).join('')
  return s
}

export function validateDescription(text, maxChars = MAX_DESC_CHARS, { required = true } = {}) {
  const s = String(text || '').trim()
  if (!s) return required ? 'description required' : null
  if (charCount(s) > maxChars) return `description max ${maxChars} characters`
  return null
}

function listMediaFiles(dir, prefix) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => /\.(jpe?g|png|webp|gif|webm|mp4|mov)$/i.test(n))
    .map((n) => `${prefix}/${n}`)
    .sort()
}

/** Optional seed overlays written once when a catalog row is first created. */
function loadSeedStories() {
  const seedPath = path.join(config.dataDir, 'seed-stories.json')
  if (!fs.existsSync(seedPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(seedPath, 'utf8')) || {}
  } catch {
    return {}
  }
}

function vaultPathForSrc(src) {
  const rel = String(src || '').replace(/^\//, '')
  return path.join(config.vaultDir, rel)
}

/** One-time / boot: copy leftover public assets into the vault. */
export function migratePublicToVault() {
  for (const folder of ['media', 'video', 'sfx']) {
    const from = path.join(config.publicDir, folder)
    const to = path.join(config.vaultDir, folder)
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(to, { recursive: true })
    for (const name of fs.readdirSync(from)) {
      const src = path.join(from, name)
      const dst = path.join(to, name)
      try {
        if (!fs.statSync(src).isFile()) continue
        if (!fs.existsSync(dst) || fs.statSync(src).size !== fs.statSync(dst).size) {
          fs.copyFileSync(src, dst)
        }
      } catch {
        /* skip */
      }
    }
  }
}

export function scanLibraryPaths() {
  const photos = listMediaFiles(path.join(config.vaultDir, 'media'), '/media')
  const videos = listMediaFiles(path.join(config.vaultDir, 'video'), '/video')
  return { photos, videos }
}

/**
 * Ensure every on-disk vault asset has a catalog entry; keep existing edits.
 * Non-destructive: missing files are flagged, not deleted, unless few and clearly gone.
 */
export function syncCatalogFromDisk() {
  migratePublicToVault()
  const catalog = loadCatalog()
  const seeds = loadSeedStories()
  const { photos, videos } = scanLibraryPaths()
  const onDisk = new Set([...photos, ...videos])
  const now = Date.now()
  let changed = false

  for (const src of photos) {
    if (!catalog.items[src]) {
      const seed = seeds[src] || seeds[path.basename(src)] || {}
      catalog.items[src] = {
        title: seed.title || path.basename(src),
        description: seed.description || seed.story || '',
        rating: seed.rating || 'R — pending edit',
        kind: 'photo',
        source: 'seed',
        featured: false,
        hidden: false,
        uploaderIp: null,
        uploadedAt: null,
        updatedAt: now,
        acceptedAt: null,
        originalName: path.basename(src),
      }
      changed = true
    } else if (catalog.items[src].missing) {
      catalog.items[src].missing = false
      changed = true
    }
  }
  for (const src of videos) {
    if (!catalog.items[src]) {
      const seed = seeds[src] || seeds[path.basename(src)] || {}
      const base = path.basename(src, path.extname(src)).replace(/^cam_/, '').toUpperCase()
      catalog.items[src] = {
        title: seed.title || base || path.basename(src),
        description: seed.description || seed.story || '',
        rating: seed.rating || 'R — tape',
        kind: 'video',
        source: 'seed',
        featured: false,
        hidden: false,
        uploaderIp: null,
        uploadedAt: null,
        updatedAt: now,
        acceptedAt: null,
        originalName: path.basename(src),
      }
      changed = true
    } else if (catalog.items[src].missing) {
      catalog.items[src].missing = false
      changed = true
    }
  }

  const keys = Object.keys(catalog.items)
  const missingKeys = keys.filter((src) => !onDisk.has(src))
  const missingRatio = keys.length ? missingKeys.length / keys.length : 0

  // Only hard-delete when a small number are missing (<20%). Otherwise mark missing.
  if (missingKeys.length && missingRatio < 0.2) {
    for (const src of missingKeys) {
      delete catalog.items[src]
      changed = true
    }
  } else {
    for (const src of missingKeys) {
      if (!catalog.items[src].missing) {
        catalog.items[src].missing = true
        changed = true
      }
    }
  }

  if (changed) saveCatalog(catalog)
  return catalog
}

export function publicCatalogView() {
  const catalog = syncCatalogFromDisk()
  /** @type {Record<string, { title: string, description: string, rating: string, kind: string }>} */
  const items = {}
  for (const [src, item] of Object.entries(catalog.items)) {
    if (item.hidden || item.missing) continue
    items[src] = {
      title: item.title || '',
      description: item.description || '',
      rating: item.rating || '',
      kind: item.kind || 'photo',
    }
  }
  return { updatedAt: catalog.updatedAt, items }
}

export function adminLibraryView() {
  const catalog = syncCatalogFromDisk()
  const rows = Object.entries(catalog.items)
    .map(([src, item]) => ({ src, ...item }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return rows
}

export function updateCatalogItem(src, patch) {
  const catalog = syncCatalogFromDisk()
  const item = catalog.items[src]
  if (!item) return null
  if (typeof patch.title === 'string') item.title = patch.title.trim().slice(0, 160)
  if (typeof patch.description === 'string') {
    item.description = sanitizeDescription(patch.description, MAX_DESC_CHARS)
  }
  if (typeof patch.rating === 'string') item.rating = patch.rating.trim().slice(0, 80)
  item.updatedAt = Date.now()
  catalog.items[src] = item
  saveCatalog(catalog)
  audit('library.edit', { src })
  return { src, ...item }
}

export function setItemHidden(src, hidden) {
  const catalog = syncCatalogFromDisk()
  const item = catalog.items[src]
  if (!item) return null
  item.hidden = Boolean(hidden)
  item.updatedAt = Date.now()
  saveCatalog(catalog)
  audit('library.hide', { src, hidden: item.hidden })
  return { src, ...item }
}

export function setItemFeatured(src, featured) {
  const catalog = syncCatalogFromDisk()
  const item = catalog.items[src]
  if (!item) return null
  item.featured = Boolean(featured)
  // never rewrite provenance
  item.updatedAt = Date.now()
  saveCatalog(catalog)
  audit('library.feature', { src, featured: item.featured })
  return { src, ...item }
}

function assertLibrarySrc(src) {
  if (typeof src !== 'string') return false
  if (!src.startsWith('/media/') && !src.startsWith('/video/')) return false
  if (src.includes('..') || src.includes('\\') || src.includes('\0')) return false
  if (src.split('/').length !== 3) return false
  return true
}

/** Permanently remove a library asset from vault + catalog. */
export function deleteCatalogItem(src) {
  if (!assertLibrarySrc(src)) return { ok: false, error: 'invalid src' }

  const catalog = syncCatalogFromDisk()
  const item = catalog.items[src] || null
  const vaultAbs = vaultPathForSrc(src)
  if (!vaultAbs.startsWith(config.vaultDir)) return { ok: false, error: 'bad path' }

  const removed = []
  if (fs.existsSync(vaultAbs) && fs.statSync(vaultAbs).isFile()) {
    fs.unlinkSync(vaultAbs)
    removed.push(vaultAbs)
  }

  // also scrub leftover public / dist copies if any
  for (const root of [config.publicDir, config.distDir]) {
    if (!fs.existsSync(root)) continue
    const rel = src.replace(/^\//, '')
    const abs = path.join(root, rel)
    if (abs.startsWith(root) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      try {
        fs.unlinkSync(abs)
        removed.push(abs)
      } catch {
        /* ignore */
      }
    }
  }

  if (catalog.items[src]) {
    delete catalog.items[src]
    saveCatalog(catalog)
  }

  const stats = rebuildMediaIndexes()
  audit('library.delete', { src, removedFiles: removed.length })
  return {
    ok: true,
    src,
    deleted: Boolean(item) || removed.length > 0,
    removedFiles: removed.length,
    item,
    stats,
  }
}

/** Indexes are no longer public — kept as vault-side inventory stats only. */
export function rebuildMediaIndexes() {
  const { photos, videos } = scanLibraryPaths()
  // Write empty stubs into public so old clients / caches don't leak path lists
  const empty = '[]\n'
  try {
    fs.writeFileSync(path.join(config.publicDir, 'media-index.json'), empty)
    fs.writeFileSync(path.join(config.publicDir, 'video-index.json'), empty)
    if (fs.existsSync(config.distDir)) {
      fs.writeFileSync(path.join(config.distDir, 'media-index.json'), empty)
      fs.writeFileSync(path.join(config.distDir, 'video-index.json'), empty)
    }
  } catch {
    /* ignore */
  }
  return { photos: photos.length, videos: videos.length }
}

function extForType(type, name) {
  const fromName = path.extname(name || '').toLowerCase()
  if (fromName && /^\.(jpe?g|png|webp|gif|webm|mp4|mov)$/.test(fromName)) return fromName
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/webm': '.webm',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
  }
  return map[type] || '.bin'
}

function sniffKind(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45) {
    return 'image/webp'
  }
  // EBML / webm
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm'
  // ftyp
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4'
  return null
}

export function acceptPending(meta, filePath, { title, description, rating } = {}) {
  const head = Buffer.alloc(32)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, head, 0, 32, 0)
  } finally {
    fs.closeSync(fd)
  }
  const sniffed = sniffKind(head)
  const claimed = String(meta.type || '')
  const type = sniffed || claimed
  const isVideo = type.startsWith('video/')
  if (!type.startsWith('image/') && !type.startsWith('video/')) {
    throw Object.assign(new Error('unsupported file'), { code: 'TYPE' })
  }

  const folder = isVideo ? 'video' : 'media'
  const ext = extForType(type, meta.name)
  // Opaque random id — no Date.now() leak
  const destName = `a_${randomBytes(16).toString('hex')}${ext}`
  const destRel = `/${folder}/${destName}`
  const destAbs = path.join(config.vaultDir, folder, destName)
  fs.mkdirSync(path.dirname(destAbs), { recursive: true })
  fs.copyFileSync(filePath, destAbs)

  const catalog = syncCatalogFromDisk()
  const desc = sanitizeDescription(description ?? meta.description ?? '', MAX_DESC_CHARS)
  catalog.items[destRel] = {
    title: String(title || 'untitled submission').trim().slice(0, 160),
    description: desc,
    rating: String(rating || 'R — community submit').trim().slice(0, 80),
    kind: isVideo ? 'video' : 'photo',
    source: 'accepted',
    featured: true,
    hidden: false,
    uploaderIp: meta.ip || null,
    uploaderIpHash: meta.ipHash || null,
    uploadedAt: meta.created || Date.now(),
    updatedAt: Date.now(),
    acceptedAt: Date.now(),
    originalName: meta.name || null,
  }
  saveCatalog(catalog)
  rebuildMediaIndexes()
  audit('pending.accept', { src: destRel, pendingId: meta.id })

  try {
    fs.unlinkSync(filePath)
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(filePath + '.json')
  } catch {
    /* ignore */
  }

  return { src: destRel, item: catalog.items[destRel] }
}

export function listPending() {
  if (!fs.existsSync(config.pendingDir)) return []
  const files = fs.readdirSync(config.pendingDir).filter((n) => n.endsWith('.json'))
  const rows = []
  for (const jsonName of files) {
    const jsonPath = path.join(config.pendingDir, jsonName)
    try {
      const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      const base = jsonName.replace(/\.json$/, '')
      const filePath = path.join(config.pendingDir, base)
      if (!fs.existsSync(filePath)) continue
      const st = fs.statSync(filePath)
      rows.push({
        ...meta,
        file: base,
        size: st.size,
        previewUrl: `/api/admin/pending/${encodeURIComponent(meta.id)}/file`,
      })
    } catch {
      /* skip corrupt */
    }
  }
  rows.sort((a, b) => (b.created || 0) - (a.created || 0))
  return rows
}

export function findPending(id) {
  const rows = listPending()
  return rows.find((r) => r.id === id) || null
}

export function pendingFilePath(meta) {
  return path.join(config.pendingDir, meta.file)
}

export function denyPending(meta) {
  const filePath = pendingFilePath(meta)
  try {
    fs.unlinkSync(filePath)
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(filePath + '.json')
  } catch {
    /* ignore */
  }
  audit('pending.deny', { id: meta.id })
  return true
}
