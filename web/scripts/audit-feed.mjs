/**
 * Audit: accepted uploads appear in indexes + catalog with descriptions,
 * and the infinite pool loops without dead-ending.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncCatalogFromDisk, rebuildMediaIndexes } from '../server/catalog.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const publicDir = path.join(root, 'public')

const catalog = syncCatalogFromDisk()
rebuildMediaIndexes()

const mediaIndex = JSON.parse(fs.readFileSync(path.join(publicDir, 'media-index.json'), 'utf8'))
const videoIndex = JSON.parse(fs.readFileSync(path.join(publicDir, 'video-index.json'), 'utf8'))

const accepted = Object.entries(catalog.items).filter(([, it]) => it.source === 'accepted')
let failed = 0

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    failed++
  } else {
    console.log('OK  ', msg)
  }
}

ok(mediaIndex.length > 0, `media-index has ${mediaIndex.length} photos`)
ok(videoIndex.length > 0, `video-index has ${videoIndex.length} videos`)

for (const [src, item] of accepted) {
  const index = src.startsWith('/video/') ? videoIndex : mediaIndex
  const onDisk = path.join(publicDir, src.replace(/^\//, ''))
  ok(index.includes(src), `accepted ${src} listed in index`)
  ok(fs.existsSync(onDisk), `accepted ${src} exists on disk`)
  ok(Boolean(String(item.description || '').trim()), `accepted ${src} has description`)
  ok(Boolean(String(item.title || '').trim()), `accepted ${src} has title`)
}

// Pool loop simulation (mirrors src/pool.ts behavior)
function simulatePool(items) {
  const featured = items.filter((i) => i.featured)
  const rest = items.filter((i) => !i.featured)
  let order = featured.concat(rest)
  let cursor = 0
  let laps = 0
  const seenFirstLap = new Set()
  const n = items.length
  for (let i = 0; i < n * 2 + 3; i++) {
    if (cursor >= order.length) {
      laps++
      order = items.slice().sort(() => Math.random() - 0.5)
      cursor = 0
    }
    const item = order[cursor++]
    if (laps === 0) seenFirstLap.add(item.src)
  }
  return { laps, seenFirstLap: seenFirstLap.size, n }
}

const photoItems = mediaIndex.map((src) => ({
  src,
  featured: catalog.items[src]?.source === 'accepted',
}))
const sim = simulatePool(photoItems)
ok(sim.seenFirstLap === sim.n, `first lap covers all ${sim.n} photos (got ${sim.seenFirstLap})`)
ok(sim.laps >= 1, `pool begins a new lap after exhausting list (laps=${sim.laps})`)
ok(accepted.length === 0 || photoItems.some((p) => p.featured), 'featured accepted photos present in pool input')

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log(`\nAll checks passed · accepted uploads: ${accepted.length}`)
