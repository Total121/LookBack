import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

loadEnvFile(path.join(ROOT, '.env'))

function req(name, fallback = '') {
  const v = process.env[name]
  return v == null || v === '' ? fallback : v
}

const weak = new Set(['', 'changeme', 'password', 'admin', 'secret', '123456'])

const isCloud =
  Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME) ||
  req('CLOUD', 'false') === 'true'

function sanitizeAdminPath(raw) {
  let p = String(raw || '/alb').trim()
  if (!p.startsWith('/')) p = '/' + p
  p = p.replace(/\/+/g, '/').replace(/\/$/, '') || '/alb'
  if (!/^\/[a-zA-Z0-9_-]{3,64}$/.test(p)) return '/alb'
  const reserved = new Set(['/api', '/m', '/media', '/video', '/sfx', '/assets', '/src'])
  if (reserved.has(p)) return '/alb'
  return p
}

function resolveDir(envName, fallback) {
  const raw = req(envName, '')
  if (!raw) return fallback
  return path.resolve(raw)
}

/** Optional mount root — when set, vault/pending/data live under it unless overridden. */
const dataRoot = req('DATA_ROOT', '') ? path.resolve(req('DATA_ROOT')) : ''

const seedVaultDir = path.join(ROOT, 'vault')
const seedDataDir = path.join(ROOT, 'data')

const vaultDir = resolveDir(
  'VAULT_DIR',
  dataRoot ? path.join(dataRoot, 'vault') : seedVaultDir,
)
const pendingDir = resolveDir(
  'PENDING_DIR',
  dataRoot ? path.join(dataRoot, 'pending-uploads') : path.join(ROOT, 'pending-uploads'),
)
const dataDir = resolveDir(
  'DATA_DIR',
  dataRoot ? path.join(dataRoot, 'data') : seedDataDir,
)

export const config = {
  host: req('HOST', isCloud ? '0.0.0.0' : '127.0.0.1'),
  port: Number(req('PORT', '3947')),
  trustProxy: req('TRUST_PROXY', isCloud ? 'true' : 'false') === 'true',
  adminPath: sanitizeAdminPath(req('ADMIN_PATH', '/alb')),
  adminUsername: req('ADMIN_USERNAME', ''),
  adminPassword: req('ADMIN_PASSWORD', ''),
  sessionSecret: req('SESSION_SECRET', ''),
  sessionTtlMs: Number(req('SESSION_TTL_HOURS', '12')) * 60 * 60 * 1000,
  turnstileSiteKey: req('TURNSTILE_SITE_KEY', ''),
  turnstileSecretKey: req('TURNSTILE_SECRET_KEY', ''),
  requireTurnstile: req('REQUIRE_TURNSTILE', 'true') !== 'false',
  cookieSecure: req('COOKIE_SECURE', 'auto'),
  publicDir: path.join(ROOT, 'public'),
  distDir: path.join(ROOT, 'dist'),
  adminUiDir: path.join(ROOT, 'server', 'admin-ui'),
  /** Writable live paths (may be on a persistent disk). */
  vaultDir,
  pendingDir,
  dataDir,
  catalogPath: path.join(dataDir, 'catalog.json'),
  /** Image-baked seed (read-only source for hydrate). */
  seedVaultDir,
  seedDataDir,
  dataRoot: dataRoot || '',
}

fs.mkdirSync(config.pendingDir, { recursive: true })
fs.mkdirSync(config.dataDir, { recursive: true })
fs.mkdirSync(path.join(config.vaultDir, 'media'), { recursive: true })
fs.mkdirSync(path.join(config.vaultDir, 'media', 'thumbs'), { recursive: true })
fs.mkdirSync(path.join(config.vaultDir, 'video'), { recursive: true })
fs.mkdirSync(path.join(config.vaultDir, 'sfx'), { recursive: true })

function looksWeakSecret(s) {
  const v = String(s || '').toLowerCase()
  if (weak.has(v)) return true
  if (v.includes('change-me') || v.includes('changeme') || v.includes('local-dev') || v.includes('replace_with')) {
    return true
  }
  return false
}

export function assertSecureConfig(isProd) {
  const problems = []
  if (!config.adminUsername) problems.push('ADMIN_USERNAME is required')
  if (
    !config.adminPassword ||
    config.adminPassword.length < 12 ||
    looksWeakSecret(config.adminPassword)
  ) {
    problems.push('ADMIN_PASSWORD must be ≥12 chars and not a placeholder')
  }
  if (
    !config.sessionSecret ||
    config.sessionSecret.length < 32 ||
    looksWeakSecret(config.sessionSecret)
  ) {
    problems.push('SESSION_SECRET must be a random string of at least 32 characters (not a placeholder)')
  }
  if (config.requireTurnstile) {
    if (!config.turnstileSiteKey || !config.turnstileSecretKey) {
      problems.push('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required (or set REQUIRE_TURNSTILE=false for local-only)')
    }
  }
  if (isProd && !config.requireTurnstile) {
    problems.push('REQUIRE_TURNSTILE must be true in production')
  }
  if (isProd && problems.length) {
    console.error('[security] Refusing to start — fix .env:')
    for (const p of problems) console.error('  -', p)
    process.exit(1)
  }
  if (!isProd && problems.length) {
    console.warn('[security] Admin login will fail until .env is complete:')
    for (const p of problems) console.warn('  -', p)
  }
}

export function cookieSecureFlag(req) {
  if (config.cookieSecure === 'true') return true
  if (config.cookieSecure === 'false') return false
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
  return proto === 'https' || req.socket?.encrypted === true
}

export function generateSecretHint() {
  return createHash('sha256').update(randomBytes(32)).digest('hex')
}
