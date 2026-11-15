/** No random ambient noise. Jumpscares only — layered real screams. */

let ac: AudioContext | null = null
let scareBusy = false
let lastScare = 0

const SCARE_IMGS = [
  '/media/jumpscare-face.jpg',
  '/media/crt-scream.jpg',
  '/media/static-face.jpg',
  '/media/nv-silhouette.jpg',
  '/media/closet-eyes.jpg',
  '/media/stair-hand.jpg',
  '/media/hall-entity.jpg',
  '/media/mirror-double.jpg',
]

const SCARE_POOL = [
  '/sfx/scare.wav',
  '/sfx/scare2.wav',
  '/sfx/scare3.wav',
  '/sfx/scare4.wav',
  '/sfx/scare5.wav',
  '/sfx/scare6.wav',
  '/sfx/scare7.wav',
  '/sfx/scare9.wav',
  '/sfx/scare10.wav',
  '/sfx/scream.wav',
  '/sfx/scream2.wav',
  '/sfx/scream3.wav',
  '/sfx/scream_w.wav',
  '/sfx/death.wav',
]

function ctx() {
  if (!ac) ac = new AudioContext()
  return ac
}

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export async function play(url: string, volume = 0.45) {
  try {
    const c = ctx()
    if (c.state === 'suspended') await c.resume()
    const res = await fetch(url)
    const buf = await c.decodeAudioData(await res.arrayBuffer())
    const src = c.createBufferSource()
    const g = c.createGain()
    g.gain.value = volume
    src.buffer = buf
    src.connect(g)
    g.connect(c.destination)
    src.start()
    return src
  } catch {
    return null
  }
}

/** Unlock audio on ENTER — no ambient loop. */
export async function armHaunt() {
  await ctx().resume()
}

export function jumpscare() {
  if (scareBusy) return
  if (Date.now() - lastScare < 20000) return
  scareBusy = true
  lastScare = Date.now()

  // Layer multiple real screams for impact
  void play(pick(SCARE_POOL), 0.78)
  setTimeout(() => void play(pick(SCARE_POOL), 0.55), 120)
  setTimeout(() => void play(pick(['/sfx/thunder.wav', '/sfx/glass.wav', '/sfx/blood.wav', '/sfx/chainsaw.wav', '/sfx/chains.wav']), 0.4), 60)

  const mode = Math.random() > 0.4 ? 'behind' : 'face'
  const el = document.createElement('div')
  el.className = 'jumpscare mode-' + mode

  if (mode === 'behind') {
    el.innerHTML = `<div class="behind-scare">
      <div class="you-silhouette"></div>
      <img class="entity" src="${pick(SCARE_IMGS)}" alt=""/>
      <div class="behind-label">IT IS BEHIND YOU</div>
    </div>`
  } else {
    el.innerHTML = `<img class="full" src="${pick(SCARE_IMGS)}" alt=""/><div class="flash"></div><div class="scare-txt">${pick(['LOOK', 'DIE', 'BEHIND', 'NOW'])}</div>`
  }

  document.body.appendChild(el)
  document.body.classList.add('shake-hard')
  // Longer hold
  setTimeout(() => {
    el.remove()
    document.body.classList.remove('shake-hard')
    scareBusy = false
  }, 1400)
}

export function trigger(kind: string) {
  if (kind === 'scare') return jumpscare()
  const map: Record<string, string> = {
    knock: '/sfx/knock.wav',
    static: '/sfx/static.wav',
    whisper: '/sfx/whisper.wav',
    creak: '/sfx/creak.wav',
    heartbeat: '/sfx/heartbeat.wav',
    scream: pick(SCARE_POOL),
    breath: '/sfx/breath.wav',
    ghost: '/sfx/ghost2.wav',
    glass: '/sfx/glass.wav',
    chains: '/sfx/chains.wav',
    sob: '/sfx/sob.wav',
    thunder: '/sfx/thunder.wav',
    dying: '/sfx/dying.wav',
    blood: '/sfx/blood.wav',
    monster: '/sfx/monster.wav',
  }
  return void play(map[kind] || '/sfx/creak.wav', 0.35)
}
