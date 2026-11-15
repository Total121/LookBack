/**
 * Boot payload — scare faces + sfx arrive as opaque /m/<token> URLs.
 * Real vault paths never ship in the client bundle for runtime use.
 */

export type BootSfx = Record<string, string>
export type BootFlags = {
  uploadsEnabled?: boolean
  reactionsEnabled?: boolean
  ambientHaunt?: boolean
  dreadMultiplier?: number
  maintenanceMode?: boolean
  maintenanceMessage?: string
  announcement?: string
}

export type BootPayload = {
  ok?: boolean
  maintenance?: boolean
  message?: string
  scare: string[]
  faces: string[]
  sfx: BootSfx
  flags: BootFlags
  issuedAt?: number
  ttlMs?: number
}

let boot: BootPayload | null = null
let bootPromise: Promise<BootPayload> | null = null

const EMPTY: BootPayload = {
  scare: [],
  faces: [],
  sfx: {},
  flags: {},
}

export async function loadBoot(force = false): Promise<BootPayload> {
  if (boot && !force) return boot
  if (bootPromise && !force) return bootPromise
  bootPromise = (async () => {
    try {
      const res = await fetch('/api/boot', { cache: 'no-store' })
      if (!res.ok) return EMPTY
      const data = (await res.json()) as BootPayload
      boot = {
        scare: Array.isArray(data.scare) ? data.scare : [],
        faces: Array.isArray(data.faces) ? data.faces : [],
        sfx: data.sfx && typeof data.sfx === 'object' ? data.sfx : {},
        flags: data.flags || {},
        maintenance: Boolean(data.maintenance),
        message: data.message,
        issuedAt: data.issuedAt,
        ttlMs: data.ttlMs,
        ok: data.ok,
      }
      return boot
    } catch {
      return EMPTY
    } finally {
      bootPromise = null
    }
  })()
  return bootPromise
}

export function getBoot() {
  return boot
}

export function bootSfx(key: string, fallback = '') {
  return boot?.sfx?.[key] || fallback
}

export function bootScarePool() {
  return boot?.scare?.length ? boot.scare : []
}

export function bootFaces() {
  return boot?.faces?.length ? boot.faces : bootScarePool()
}
