/**
 * Capture ~10s of webcam reaction (after consent) and ship to admin.
 */

import { dreadIntensity } from './dread'

const MAX_BYTES = 8 * 1024 * 1024

export async function captureWebcamReaction(
  stream: MediaStream,
  reason: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!stream?.active) return { ok: false, error: 'no stream' }

  // Prefer webm; fall back silently
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : ''
  if (!mime) return { ok: false, error: 'recorder unsupported' }

  const chunks: BlobPart[] = []
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 650_000 })
  } catch {
    return { ok: false, error: 'recorder failed' }
  }

  const done = new Promise<Blob>((resolve) => {
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data)
    }
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }))
  })

  try {
    rec.start(250)
  } catch {
    return { ok: false, error: 'start failed' }
  }

  await new Promise((r) => setTimeout(r, 10_000))
  if (rec.state !== 'inactive') {
    try {
      rec.stop()
    } catch {
      /* ignore */
    }
  }

  const blob = await done
  if (!blob.size || blob.size > MAX_BYTES) {
    return { ok: false, error: 'empty or too large' }
  }

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
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || 'upload failed' }
    }
    return { ok: true, id: data.id }
  } catch {
    return { ok: false, error: 'network' }
  }
}
