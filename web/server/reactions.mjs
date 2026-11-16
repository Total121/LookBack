import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { config } from './config.mjs'
import { getSettings, audit, isBanned } from './settings.mjs'
import { clientIp, sendJson, hashIp } from './security.mjs'

export const reactionsDir = path.join(config.dataDir, 'reactions')
fs.mkdirSync(reactionsDir, { recursive: true })

const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_WINDOW = 6
const MAX_BYTES = 8 * 1024 * 1024
/** @type {Map<string, number[]>} */
const hits = new Map()

function peek(ip) {
  const now = Date.now()
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  hits.set(ip, arr)
  return arr
}

function listMeta() {
  return fs
    .readdirSync(reactionsDir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(reactionsDir, n), 'utf8'))
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.created || 0) - (a.created || 0))
}

export function listReactions() {
  return listMeta().map((m) => ({
    ...m,
    previewUrl: `/api/admin/reactions/${encodeURIComponent(m.id)}/file`,
  }))
}

export function getReaction(id) {
  return listMeta().find((m) => m.id === id) || null
}

export function deleteReaction(id) {
  const meta = getReaction(id)
  if (!meta) return false
  const base = path.join(reactionsDir, meta.file || `${id}.webm`)
  try {
    fs.unlinkSync(base)
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(path.join(reactionsDir, id + '.json'))
  } catch {
    /* ignore */
  }
  audit('reaction.delete', { id })
  return true
}

export function purgeOldReactions() {
  const days = getSettings().reactionRetentionDays || 30
  const cut = Date.now() - days * 86400000
  let n = 0
  for (const m of listMeta()) {
    if ((m.created || 0) < cut) {
      if (deleteReaction(m.id)) n++
    }
  }
  audit('reaction.purge', { removed: n, days })
  return n
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > limit) {
        reject(Object.assign(new Error('too large'), { code: 'LIMIT' }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Public POST /api/reactions */
export async function handlePublicReactions(req, res) {
  const url = (req.url || '').split('?')[0]
  if (!url.startsWith('/api/reactions')) return false

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return true
  }

  if (req.method !== 'POST' || url !== '/api/reactions') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return true
  }

  const settings = getSettings()
  if (!settings.reactionsEnabled) {
    sendJson(res, 403, { ok: false, error: 'reactions disabled' })
    return true
  }

  const ip = clientIp(req)
  if (isBanned(ip)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' })
    return true
  }
  const arr = peek(ip)
  if (arr.length >= MAX_PER_WINDOW) {
    sendJson(res, 429, { ok: false, error: 'reaction rate limit' })
    return true
  }

  let body
  try {
    body = await readRawBody(req, MAX_BYTES)
  } catch (e) {
    sendJson(res, e?.code === 'LIMIT' ? 413 : 400, { ok: false, error: 'bad body' })
    return true
  }

  if (!body || body.length < 32) {
    sendJson(res, 400, { ok: false, error: 'empty' })
    return true
  }
  const isWebm = body[0] === 0x1a && body[1] === 0x45 && body[2] === 0xdf && body[3] === 0xa3
  // ISO BMFF / mp4 ftyp at offset 4
  const isMp4 =
    body.length > 8 &&
    body[4] === 0x66 &&
    body[5] === 0x74 &&
    body[6] === 0x79 &&
    body[7] === 0x70
  if (!isWebm && !isMp4) {
    sendJson(res, 400, { ok: false, error: 'invalid media' })
    return true
  }

  const type = String(req.headers['content-type'] || (isWebm ? 'video/webm' : 'video/mp4'))
    .split(';')[0]
    .trim()
  if (!type.startsWith('video/')) {
    sendJson(res, 400, { ok: false, error: 'video only' })
    return true
  }

  let reason = ''
  try {
    reason = decodeURIComponent(String(req.headers['x-reaction-reason'] || ''))
  } catch {
    reason = String(req.headers['x-reaction-reason'] || '')
  }
  const dread = Number(req.headers['x-dread-intensity'] || 0)

  const id = `r_${randomBytes(16).toString('hex')}`
  const ext = isMp4 ? 'mp4' : 'webm'
  const file = `${id}.${ext}`
  fs.mkdirSync(reactionsDir, { recursive: true })
  fs.writeFileSync(path.join(reactionsDir, file), body)
  const meta = {
    id,
    file,
    type: isMp4 ? 'video/mp4' : 'video/webm',
    size: body.length,
    reason: reason.slice(0, 80),
    dread,
    ip,
    ipHash: hashIp(ip),
    created: Date.now(),
  }
  fs.writeFileSync(path.join(reactionsDir, id + '.json'), JSON.stringify(meta, null, 2))
  arr.push(Date.now())
  hits.set(ip, arr)
  audit('reaction.create', { id, ipHash: meta.ipHash })

  sendJson(res, 200, { ok: true, id })
  return true
}
