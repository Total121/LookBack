/**
 * Capture ~10s of webcam reaction (after consent) and ship to admin.
 * Uses a cloned track so the live canvas overlay does not starve the recorder.
 */

import { dreadIntensity } from './dread'

const MAX_BYTES = 8 * 1024 * 1024

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]
  for (const m of candidates) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
    } catch {
      /* ignore */
    }
  }
  return ''
}

export async function captureWebcamReaction(
  stream: MediaStream,
  reason: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!stream?.active) return { ok: false, error: 'no stream' }
  if (typeof MediaRecorder === 'undefined') return { ok: false, error: 'recorder unsupported' }

  const mime = pickMime()
  // Prefer webm for server magic check; still try mp4 upload if needed
  const videoTracks = stream.getVideoTracks()
  if (!videoTracks.length) return { ok: false, error: 'no video track' }

  // Dedicated clone — recording must not share the live preview track lifecycle oddly
  let recStream: MediaStream
  try {
    const clones = videoTracks.map((t) => t.clone())
    recStream = new MediaStream(clones)
  } catch {
    recStream = stream
  }

  const chunks: BlobPart[] = []
  let rec: MediaRecorder
  try {
    rec = mime
      ? new MediaRecorder(recStream, { mimeType: mime, videoBitsPerSecond: 900_000 })
      : new MediaRecorder(recStream, { videoBitsPerSecond: 900_000 })
  } catch {
    stopClones(recStream, stream)
    return { ok: false, error: 'recorder failed' }
  }

  const done = new Promise<Blob>((resolve, reject) => {
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data)
    }
    rec.onerror = () => reject(new Error('recorder error'))
    rec.onstop = () => {
      const type = (rec.mimeType || mime || 'video/webm').split(';')[0]
      resolve(new Blob(chunks, { type }))
    }
  })

  try {
    rec.start(400)
  } catch {
    stopClones(recStream, stream)
    return { ok: false, error: 'start failed' }
  }

  await new Promise((r) => setTimeout(r, 10_000))
  try {
    if (rec.state === 'recording') rec.requestData()
  } catch {
    /* ignore */
  }
  if (rec.state !== 'inactive') {
    try {
      rec.stop()
    } catch {
      /* ignore */
    }
  }

  let blob: Blob
  try {
    blob = await Promise.race([
      done,
      new Promise<Blob>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ])
  } catch {
    stopClones(recStream, stream)
    return { ok: false, error: 'stop failed' }
  } finally {
    stopClones(recStream, stream)
  }

  if (!blob.size || blob.size > MAX_BYTES) {
    return { ok: false, error: 'empty or too large' }
  }

  return uploadReaction(blob, reason, 0)
}

function stopClones(recStream: MediaStream, original: MediaStream) {
  if (recStream === original) return
  for (const t of recStream.getTracks()) {
    try {
      t.stop()
    } catch {
      /* ignore */
    }
  }
}

async function uploadReaction(
  blob: Blob,
  reason: string,
  attempt: number,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch('/api/reactions', {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'video/webm',
        'X-Reaction-Reason': encodeURIComponent(reason.slice(0, 80)),
        'X-Dread-Intensity': String(Math.round(dreadIntensity() * 100) / 100),
      },
      body: blob,
      cache: 'no-store',
    })
    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get('Retry-After') || 2 + attempt)
      await new Promise((r) => setTimeout(r, Math.min(6, wait) * 1000))
      return uploadReaction(blob, reason, attempt + 1)
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || 'upload failed' }
    }
    return { ok: true, id: data.id }
  } catch {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      return uploadReaction(blob, reason, attempt + 1)
    }
    return { ok: false, error: 'network' }
  }
}
