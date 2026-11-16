/**
 * Feed thumbnails — WebP sidecars under vault/media/thumbs/.
 * Full originals stay untouched for tear overlays.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { config } from './config.mjs'

// Smaller feed thumbs = much faster collage paint (full originals still for tear)
const THUMB_EDGE = 480
const THUMB_QUALITY = 68
const THUMB_VERSION = 'thumb-v2'
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

let sharpMod = null
let sharpFailed = false

async function getSharp() {
  if (sharpFailed) return null
  if (sharpMod) return sharpMod
  try {
    sharpMod = (await import('sharp')).default
    return sharpMod
  } catch {
    sharpFailed = true
    console.warn('[thumbs] sharp unavailable — serving full images for tiles')
    return null
  }
}

export function thumbRelForSrc(src) {
  if (typeof src !== 'string' || !src.startsWith('/media/')) return null
  if (src.includes('/thumbs/')) return null
  const ext = path.extname(src).toLowerCase()
  if (!IMAGE_EXT.has(ext)) return null
  const id = createHash('sha256')
    .update(THUMB_VERSION + ':' + src)
    .digest('base64url')
    .slice(0, 22)
  return `/media/thumbs/${id}.webp`
}

export function thumbAbsForSrc(src) {
  const rel = thumbRelForSrc(src)
  if (!rel) return null
  return path.join(config.vaultDir, rel.replace(/^\//, ''))
}

export function hasThumb(src) {
  const abs = thumbAbsForSrc(src)
  return Boolean(abs && fs.existsSync(abs) && fs.statSync(abs).isFile())
}

/**
 * Build or refresh a single thumb. Returns vault-relative thumb src or null.
 */
export async function ensureThumb(src, absOriginal) {
  const rel = thumbRelForSrc(src)
  if (!rel) return null
  const outAbs = path.join(config.vaultDir, rel.replace(/^\//, ''))
  if (fs.existsSync(outAbs)) return rel

  const sharp = await getSharp()
  if (!sharp) return null
  if (!absOriginal || !fs.existsSync(absOriginal)) return null

  try {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true })
    const tmp = outAbs + '.tmp'
    await sharp(absOriginal, { failOn: 'none', animated: false })
      .rotate()
      .resize({
        width: THUMB_EDGE,
        height: THUMB_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: THUMB_QUALITY, effort: 4 })
      .toFile(tmp)
    fs.renameSync(tmp, outAbs)
    return rel
  } catch (err) {
    try {
      if (fs.existsSync(outAbs + '.tmp')) fs.unlinkSync(outAbs + '.tmp')
    } catch {
      /* ignore */
    }
    console.warn('[thumbs] failed', src, err?.message || err)
    return null
  }
}

/**
 * Background: ensure thumbs for every still in the vault.
 * Yields between files so boot stays responsive.
 */
export async function ensureAllThumbs(vaultAbsFn) {
  const mediaDir = path.join(config.vaultDir, 'media')
  if (!fs.existsSync(mediaDir)) return { ok: 0, skip: 0 }
  const sharp = await getSharp()
  if (!sharp) return { ok: 0, skip: 0 }

  let ok = 0
  let skip = 0
  const names = fs.readdirSync(mediaDir).filter((n) => {
    if (n === 'thumbs') return false
    return IMAGE_EXT.has(path.extname(n).toLowerCase())
  })

  for (const name of names) {
    const src = `/media/${name}`
    if (hasThumb(src)) {
      skip++
      continue
    }
    const abs = typeof vaultAbsFn === 'function' ? vaultAbsFn(src) : path.join(mediaDir, name)
    const made = await ensureThumb(src, abs)
    if (made) ok++
    // breathe — avoid pegging CPU on small instances
    await new Promise((r) => setTimeout(r, 8))
  }
  return { ok, skip }
}
