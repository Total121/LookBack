/** Ask for webcam → show viewer with ghost overlay behind them. */

import { play, jumpscare } from './audio/haunt'

let stream: MediaStream | null = null
let raf = 0

export function closeWebcam() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  document.querySelectorAll('.webcam-possess').forEach((el) => el.remove())
}

export async function askWebcamPossession(): Promise<boolean> {
  closeWebcam()
  const overlay = document.createElement('div')
  overlay.className = 'webcam-ask'
  overlay.innerHTML = `<div class="webcam-ask-box">
    <p class="gothic">𝖈𝖆𝖓 𝖎 𝖘𝖊𝖊 𝖞𝖔𝖚</p>
    <p class="sub">allow camera. it already knows what your room looks like. it just wants confirmation.</p>
    <div class="ask-row">
      <button type="button" data-yes>yes — show me</button>
      <button type="button" data-no>not yet</button>
    </div>
  </div>`
  document.body.appendChild(overlay)

  return new Promise((resolve) => {
    overlay.querySelector('[data-no]')!.addEventListener('click', () => {
      overlay.remove()
      void play('/sfx/laugh.wav', 0.35)
      resolve(false)
    })
    overlay.querySelector('[data-yes]')!.addEventListener('click', async () => {
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
    void play('/sfx/glitch.wav', 0.3)
    const denied = document.createElement('div')
    denied.className = 'webcam-ask'
    denied.innerHTML = `<div class="webcam-ask-box"><p class="gothic">𝖆𝖈𝖈𝖊𝖘𝖘 𝖉𝖊𝖓𝖎𝖊𝖉</p><p class="sub">it will use the photos instead.</p></div>`
    document.body.appendChild(denied)
    setTimeout(() => denied.remove(), 2200)
    setTimeout(() => jumpscare(), 600)
    return false
  }

  void play('/sfx/static.wav', 0.25)
  const wrap = document.createElement('div')
  wrap.className = 'webcam-possess'
  wrap.innerHTML = `<div class="cam-frame">
    <video playsinline muted autoplay></video>
    <canvas></canvas>
    <div class="cam-chrome"><span class="blink">● LIVE — YOUR ROOM</span><span data-x style="cursor:pointer">[x]</span></div>
    <div class="cam-msg">do not look behind you</div>
  </div>`
  document.body.appendChild(wrap)

  const video = wrap.querySelector('video')!
  const canvas = wrap.querySelector('canvas')!
  const ctx = canvas.getContext('2d')!
  video.srcObject = stream
  await video.play().catch(() => {})

  const ghosts = [
    '/media/nv-silhouette.jpg',
    '/media/hall-entity.jpg',
    '/media/closet-eyes.jpg',
    '/media/jumpscare-face.jpg',
    '/media/stair-hand.jpg',
  ]
  const ghostImg = new Image()
  ghostImg.src = ghosts[Math.floor(Math.random() * ghosts.length)]

  let t0 = performance.now()
  let flashed = false

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

    // scanlines + red tint
    ctx.fillStyle = 'rgba(80,0,0,0.18)'
    ctx.fillRect(0, 0, w, h)
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      ctx.fillRect(0, y, w, 1)
    }

    // ghost behind / beside the person
    if (ghostImg.complete) {
      const pulse = 0.25 + Math.sin((now - t0) / 400) * 0.15
      ctx.globalAlpha = pulse
      const gw = w * 0.45
      const gh = h * 0.7
      ctx.drawImage(ghostImg, w * 0.55, h * 0.2, gw, gh)
      ctx.globalAlpha = pulse * 0.5
      ctx.drawImage(ghostImg, -gw * 0.2, h * 0.15, gw, gh)
      ctx.globalAlpha = 1
    }

    // occasional face flash
    if (!flashed && now - t0 > 3500 && Math.random() > 0.992) {
      flashed = true
      void play('/sfx/scare.wav', 0.55)
      ctx.globalAlpha = 0.85
      ctx.drawImage(ghostImg, 0, 0, w, h)
      ctx.globalAlpha = 1
      wrap.querySelector('.cam-msg')!.textContent = 'IT IS IN THE ROOM'
      setTimeout(() => {
        flashed = false
      }, 400)
    }

    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  wrap.querySelector('[data-x]')!.addEventListener('click', () => {
    closeWebcam()
    void play('/sfx/dying.wav', 0.3)
    setTimeout(() => jumpscare(), 400)
  })

  setTimeout(() => {
    if (stream) void play('/sfx/whisper.wav', 0.35)
  }, 5000)

  return true
}
