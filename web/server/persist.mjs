/**
 * Durable data root support.
 * When DATA_ROOT (or VAULT_DIR / DATA_DIR / PENDING_DIR) points at a mounted disk,
 * seed vault media is copied once from the image so the collage still works after
 * the writable volume takes over.
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'

function copyMissingFile(src, dst) {
  if (fs.existsSync(dst)) return false
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  return true
}

function copyTreeMissing(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return 0
  let n = 0
  const walk = (rel = '') => {
    const absFrom = path.join(fromDir, rel)
    const entries = fs.readdirSync(absFrom, { withFileTypes: true })
    for (const ent of entries) {
      const child = rel ? path.join(rel, ent.name) : ent.name
      if (ent.isDirectory()) {
        // Never seed generated thumbs — they are rebuilt
        if (ent.name === 'thumbs') continue
        walk(child)
      } else if (ent.isFile()) {
        const dst = path.join(toDir, child)
        if (copyMissingFile(path.join(fromDir, child), dst)) n++
      }
    }
  }
  walk()
  return n
}

/**
 * If the live vault/data dirs are empty (fresh disk), hydrate from the image seed.
 * Safe to call every boot — only copies missing files.
 */
export function hydrateFromSeed() {
  const seedVault = config.seedVaultDir
  const seedData = config.seedDataDir
  let copied = 0

  if (seedVault && path.resolve(seedVault) !== path.resolve(config.vaultDir)) {
    for (const folder of ['media', 'video', 'sfx']) {
      copied += copyTreeMissing(path.join(seedVault, folder), path.join(config.vaultDir, folder))
    }
  }

  if (seedData && path.resolve(seedData) !== path.resolve(config.dataDir)) {
    for (const name of ['catalog.json', 'seed-stories.json', 'settings.json']) {
      const from = path.join(seedData, name)
      const to = path.join(config.dataDir, name)
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        if (copyMissingFile(from, to)) copied++
      }
    }
  }

  fs.mkdirSync(path.join(config.vaultDir, 'media', 'thumbs'), { recursive: true })
  fs.mkdirSync(path.join(config.vaultDir, 'video'), { recursive: true })
  fs.mkdirSync(path.join(config.vaultDir, 'sfx'), { recursive: true })
  fs.mkdirSync(config.pendingDir, { recursive: true })
  fs.mkdirSync(config.dataDir, { recursive: true })

  return copied
}
