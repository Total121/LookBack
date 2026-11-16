/** Horror corpus — photos, videos, case scraps. No real victim corpses. */

export type PhotoStory = {
  src: string
  /** Smaller WebP for collage tiles when available; full `src` for tear. */
  thumbSrc?: string
  title: string
  rating: string
  story: string
  /** Community-accepted uploads — surfaced earlier in the first scroll lap. */
  featured?: boolean
}
export type FeedVid = {
  src: string
  label: string
  title: string
  rating: string
  story: string
  featured?: boolean
}
export type MurderFile = { id: string; title: string; rating: string; body: string }

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const MEDIA_FILES: string[] = []
export const HAND_VIDEOS: Array<{ src: string; label: string }> = []

export const MURDERS: MurderFile[] = [
  {
    id: 'motel13',
    title: 'CASE — MOTEL 13',
    rating: 'R — sex / murder',
    body: `Checked in to fuck. Lens found the window. Blade. Arterial spray. Bodies posed naked. THANKS FOR THE SHOW in lipstick and blood.`,
  },
  {
    id: 'wardc',
    title: 'CASE — WARD C',
    rating: 'R — drugs / murder',
    body: `Oxy. Smiles cut into cheeks. Black water in lungs. Jars in the closet labeled with the dead.`,
  },
  {
    id: 'chat',
    title: 'CASE — CHAT 04:44',
    rating: 'R — stalking / murder',
    body: `Send nudes. Come outside. Second figure folded her into the dark. Killer’s eyes reflect LOOK BACK.`,
  },
  {
    id: 'forest',
    title: 'CASE — TRAIL CAM 09',
    rating: 'R — body horror',
    body: `Followed by himself from yesterday. Skin on a log. Bones mailed: assembly required.`,
  },
  {
    id: 'stream',
    title: 'CASE — PIRATE STREAM',
    rating: 'R — sex / murder',
    body: `Couple fucking. Third shape in doorway. Camera flips to your bedroom. Chat: LOL.`,
  },
  {
    id: 'needle',
    title: 'CASE — NEEDLE HOUSE',
    rating: 'R — drugs / murder',
    body: `Mirror asks for a vein. Yes means the tub. Tracks form a pentagram.`,
  },
  {
    id: 'altar',
    title: 'CASE — HARD DRIVE ALTAR',
    rating: 'R — occult / sex',
    body: `Blood spit cum stolen IDs. Amen in chat. Wake with USB around the throat.`,
  },
  {
    id: 'guest',
    title: 'CASE — HOUSEGUEST',
    rating: 'R — home invasion',
    body: `Opened naked. It wore his jacket. Sex became meat. Polaroid of you from outside.`,
  },
  {
    id: 'bath',
    title: 'CASE — BATHROOM SITTING',
    rating: 'R — nudity / murder',
    body: `Nude pose. Lover already dead in the tub. Timer: sixty frames. Frame forty: wet hand on her shoulder.`,
  },
  {
    id: 'ride',
    title: 'CASE — LAST RIDESHARE',
    rating: 'R — murder / assault',
    body: `Wrong exit. Body nude in the passenger seat. Driver bio: can i see you.`,
  },
  {
    id: 'gallery',
    title: 'CASE — NUDE GALLERY OPENING',
    rating: 'R — nudity / murder',
    body: `Models posed live. Lights cut. When they returned one model was posed forever — throat open, smile painted on.`,
  },
  {
    id: 'church',
    title: 'CASE — AFTER HOURS MASS',
    rating: 'R — occult / sexual violence',
    body: `Congregation of one. Confessional smelled like bleach and perfume. Priest found nude under the altar with communion wine in his lungs.`,
  },
]

const verbs = [
  'bleed',
  'watch',
  'carve',
  'drain',
  'film',
  'haunt',
  'stalk',
  'inject',
  'mirror',
  'open',
  'scream',
  'possess',
  'undress',
  'bury',
  'count',
]
const nouns = [
  'webcam',
  'throat',
  'mattress',
  'needle',
  'guest',
  'hallway',
  'victim',
  'reflection',
  'altar',
  'motel',
  'ward',
  'forest',
  'nude',
  'ossuary',
  'feed',
]

/** Procedural case scraps for collage tiles. */
export function buildCaseDump(count = 400): MurderFile[] {
  const rnd = mulberry32(0xdead18)
  const out: MurderFile[] = [...MURDERS]
  for (let i = 0; i < count; i++) {
    const v = verbs[Math.floor(rnd() * verbs.length)]
    const n = nouns[Math.floor(rnd() * nouns.length)]
    const n2 = nouns[Math.floor(rnd() * nouns.length)]
    const id = `gen-${i}`
    const title = `FILE ${String(i + 1).padStart(4, '0')} — ${v.toUpperCase()} / ${n.toUpperCase()}`
    const rating = rnd() > 0.5 ? 'R — violence / nudity / paranormal' : 'R — murder / occult'
    const body = [
      `Subject ${v}s the ${n}. Witnesses report a second ${n2}. Blood typed unknown. Case open.`,
      `Recovered media shows ${n} mid-${v}. Audio: wet breathing. Location matches your last GPS ping.`,
      `Anonymous tip: do not ${v} near the ${n}. We already ${v}ed theirs. Your turn.`,
      `Autopsy note: ${n} arranged like a ${n2}. Cause: exsanguination. Motive: attention.`,
      `Chat log ends with “can i see you” then a zip of nudes that aren’t theirs anymore.`,
    ][Math.floor(rnd() * 5)]
    out.push({ id, title, rating, body })
  }
  return out
}

async function fetchJsonFresh<T>(url: string, bust = Date.now()): Promise<T | null> {
  const join = url.includes('?') ? '&' : '?'
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${url}${join}v=${bust + attempt}`, { cache: 'no-store' })
      if (res.status === 429) {
        const wait = Number(res.headers.get('Retry-After') || 1 + attempt * 2)
        await new Promise((r) => setTimeout(r, Math.min(8, Math.max(1, wait)) * 1000))
        continue
      }
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  return null
}

type LibraryRow = {
  id?: string
  url: string
  thumbUrl?: string
  title?: string
  rating?: string
  story?: string
  featured?: boolean
  label?: string
}

type LibraryPayload = {
  ok?: boolean
  photos?: LibraryRow[]
  videos?: LibraryRow[]
  updatedAt?: number
}

let libraryPromise: Promise<LibraryPayload | null> | null = null

function loadLibrary(): Promise<LibraryPayload | null> {
  if (!libraryPromise) {
    libraryPromise = fetchJsonFresh<LibraryPayload>('/api/library')
      .then((data) => {
        // Don't cache empty/failed responses — retry next enter
        if (!data?.photos?.length && !data?.videos?.length) {
          libraryPromise = null
        }
        return data
      })
      .finally(() => {
        setTimeout(() => {
          libraryPromise = null
        }, 30_000)
      })
  }
  return libraryPromise
}

/**
 * Load the public library via opaque token URLs.
 * Real /media and /video paths never leave the server.
 */
export async function loadAllPhotos(): Promise<PhotoStory[]> {
  const data = await loadLibrary()
  if (data?.photos?.length) {
    return data.photos.map((row, i) => {
      const title = row.title?.trim() || `STILL_${String(i).padStart(2, '0')}`
      return {
        src: row.url,
        thumbSrc: row.thumbUrl || undefined,
        title,
        rating: row.rating?.trim() || 'R — archive',
        story: row.story?.trim() || `Recovered still · ${title}.`,
        featured: Boolean(row.featured),
      }
    })
  }
  return []
}

export async function loadAllVideos(): Promise<FeedVid[]> {
  const data = await loadLibrary()
  if (data?.videos?.length) {
    return data.videos.map((row, i) => {
      const label = row.title?.trim() || row.label || `CAM_${String(i).padStart(2, '0')}`
      return {
        src: row.url,
        label,
        title: label,
        rating: row.rating?.trim() || 'R — tape',
        story: row.story?.trim() || `Recovered tape · ${label}.`,
        featured: Boolean(row.featured),
      }
    })
  }
  return []
}

/** Tiny preload for a fast loading screen — prefer thumbs when present. */
export function preloadSubset(photos: PhotoStory[], _videos: FeedVid[]) {
  return photos.slice(0, 8).map((p) => p.thumbSrc || p.src)
}
