import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'

const settingsPath = path.join(config.dataDir, 'settings.json')
const bansPath = path.join(config.dataDir, 'bans.json')
const auditPath = path.join(config.dataDir, 'audit.jsonl')

const DEFAULTS = {
  uploadsEnabled: true,
  reactionsEnabled: true,
  ambientHaunt: true,
  dreadMultiplier: 1,
  maintenanceMode: false,
  maintenanceMessage: 'LOOK BACK is closed. It will open its eyes again.',
  announcement: '',
  maxUploadsPerWindow: 5,
  reactionRetentionDays: 30,
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

export function getSettings() {
  return readJson(settingsPath, { ...DEFAULTS })
}

export function patchSettings(patch) {
  const cur = getSettings()
  const next = { ...cur }
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS)) continue
    next[k] = v
  }
  // clamps
  next.dreadMultiplier = Math.min(2, Math.max(0.25, Number(next.dreadMultiplier) || 1))
  next.maxUploadsPerWindow = Math.min(20, Math.max(1, Number(next.maxUploadsPerWindow) || 5))
  next.reactionRetentionDays = Math.min(365, Math.max(1, Number(next.reactionRetentionDays) || 30))
  next.uploadsEnabled = Boolean(next.uploadsEnabled)
  next.reactionsEnabled = Boolean(next.reactionsEnabled)
  next.ambientHaunt = Boolean(next.ambientHaunt)
  next.maintenanceMode = Boolean(next.maintenanceMode)
  next.maintenanceMessage = String(next.maintenanceMessage || DEFAULTS.maintenanceMessage).slice(0, 280)
  next.announcement = String(next.announcement || '').slice(0, 280)
  writeJson(settingsPath, next)
  audit('settings.patch', { keys: Object.keys(patch || {}) })
  return next
}

export function getBans() {
  const data = readJson(bansPath, { ips: [] })
  return Array.isArray(data.ips) ? data.ips : []
}

export function banIp(ip, reason = '') {
  const ips = getBans()
  const entry = {
    ip: String(ip),
    reason: String(reason || '').slice(0, 200),
    at: Date.now(),
  }
  const next = ips.filter((x) => x.ip !== entry.ip)
  next.unshift(entry)
  writeJson(bansPath, { ips: next.slice(0, 5000) })
  audit('ban', entry)
  return entry
}

export function unbanIp(ip) {
  const ips = getBans().filter((x) => x.ip !== ip)
  writeJson(bansPath, { ips })
  audit('unban', { ip })
  return true
}

export function isBanned(ip) {
  return getBans().some((x) => x.ip === ip)
}

export function audit(action, detail = {}) {
  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true })
    fs.appendFileSync(
      auditPath,
      JSON.stringify({ at: Date.now(), action, detail }) + '\n',
    )
  } catch {
    /* ignore */
  }
}

export function readAudit(limit = 100) {
  try {
    if (!fs.existsSync(auditPath)) return []
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split(/\n/).filter(Boolean)
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

export function publicSiteFlags() {
  const s = getSettings()
  return {
    uploadsEnabled: s.uploadsEnabled,
    reactionsEnabled: s.reactionsEnabled,
    ambientHaunt: s.ambientHaunt,
    dreadMultiplier: s.dreadMultiplier,
    maintenanceMode: s.maintenanceMode,
    maintenanceMessage: s.maintenanceMessage,
    announcement: s.announcement,
  }
}
