/** Massive horror corpus — photos, videos, 2000+ case scraps. No real victim corpses. */

export type PhotoStory = { src: string; title: string; rating: string; story: string }
export type FeedVid = { src: string; label: string }
export type MurderFile = { id: string; title: string; rating: string; body: string }

const STORY_BANK: Omit<PhotoStory, 'src'>[] = [
  { title: 'FRAME FROM A WIPED PHONE', rating: 'R — violence', story: `Factory reset lied. This scream-face sat in unallocated space. Timestamp: three minutes after the owner vanished. The audio lasts longer than the body did.` },
  { title: 'THE TV THAT LEARNED A FACE', rating: 'R — paranormal', story: `Motel CRT broadcast a woman on no channel. Guests woke with her face burned into the glass. Dental match: missing clerk.` },
  { title: 'STATIC IS A CROWD', rating: 'R — paranormal', story: `Slow the noise. Teeth. A name. Jane Doe with eyelids cut off so she could keep watching.` },
  { title: 'NIGHT VISION EMPTY HOUSE', rating: 'R — stalking', story: `Silhouette every night. Night sixteen: realtor gone. Silhouette waves.` },
  { title: 'WHAT WAS IN THE CLOSET', rating: 'R — murder / sexual violence', story: `Breathing behind coats. Found nude from the waist down, eyes on the closet. Footprints start inside the drywall.` },
  { title: 'THE HAND ON THE STAIRS', rating: 'R — body horror', story: `Pale hand from below. Blood trail goes UP. Something dragged him toward it.` },
  { title: 'MIRROR LAG', rating: 'R — sex / paranormal', story: `You finish twice — once in flesh, once in glass. The glass doesn’t stop.` },
  { title: 'ENTITY IN THE HALL', rating: 'R — murder', story: `Livestream. Chat saw it first. Scream cut the feed. Afterimage burned into the sensor.` },
  { title: 'GATE LEFT OPEN', rating: 'R — occult', story: `3:33 inside the cemetery. Wrists opened at a child’s grave. Empty grave was full by morning.` },
  { title: 'EYES BETWEEN TREES', rating: 'R — violence', story: `Tip-line photo: I KEPT ONE. Eyes match no animal on record.` },
  { title: 'WARD C SHADOW', rating: 'R — medical / drugs', story: `Oxy night shift. Human bite marks. Badge fused into teeth in the autoclave.` },
  { title: 'THE WATER KEPT RISING', rating: 'R — murder', story: `Three bodies on the heater. Water 4% blood. Pipe never burst.` },
  { title: 'FOG ON THE PLAYGROUND', rating: 'R — paranormal', story: `Laughter becomes chewing. Man walked out without a tongue.` },
  { title: 'ATTIC MIRROR SALE', rating: 'R — occult / sex', story: `Previous owner died mid-orgasm. The mirror finishes for you.` },
  { title: 'SEAT FOR THE THING', rating: 'R — cannibalism', story: `Extra place setting. Guest never used the door.` },
  { title: 'DOOR THAT SHOULD NOT OPEN', rating: 'R — paranormal', story: `Plans say wall. Tenants say door. Ends in your childhood bedroom.` },
  { title: 'SATURN', rating: 'R — violence / mythic horror', story: `He eats what he fathers. The painting sweats when the room is quiet.` },
  { title: 'THE NIGHTMARE', rating: 'R — sexual horror / occult', story: `Incubus on her chest. Viewers wake with weight on their ribs and someone else’s breath.` },
  { title: 'JUDITH', rating: 'R — beheading / blood', story: `She holds the head like a trophy. The blood in the paint is still sticky in infrared.` },
  { title: 'VAMPIRE LOVERS', rating: 'R — nudity / blood / sex', story: `Munch’s kiss that drains. Couples who hang it report bite bruises they didn’t give each other.` },
  { title: 'ORLOK STANDING', rating: 'R — classic horror', story: `1922. He doesn’t blink on film because he doesn’t need to. The still moves if you look away.` },
  { title: 'OSSUARY PILE', rating: 'R — death', story: `Femurs stacked like lumber. One skull faces the camera every photo no matter the angle.` },
  { title: 'PARIS CATACOMBS', rating: 'R — death', story: `Tourists who whisper their names into the bone walls hear them whispered back wrong.` },
  { title: 'NUDE IN CHARCOAL DARK', rating: 'R — nudity', story: `Model alone for the sitting. Sketches include a second body behind her she never posed with.` },
  { title: 'CHAUVE-SOURIS WOMAN', rating: 'R — nudity / occult', story: `Bat-winged nude. Owners report flying dreams that end on their bedroom ceiling, looking down at themselves.` },
  { title: 'WITCH BURNING', rating: 'R — violence / occult', story: `Crowd faces look modern under magnification. One holds a phone.` },
  { title: 'HELL DETAIL — BOSCH', rating: 'R — damnation / body horror', story: `The ear-knife. The bird-throne. Count the faces — one of them learned yours.` },
  { title: 'INFERNO PLATE', rating: 'R — violence', story: `Dore’s damned. The smoke in the engraving shifts when the tab is backgrounded.` },
  { title: 'CORPSE WATCH', rating: 'R — death / historical fiction', story: `Wake painting. The corpse’s eyes followed the painter around the room. He painted them shut. They opened in the varnish.` },
  { title: 'VANITAS', rating: 'R — death omen', story: `Skull and mirror. The mirror shows your room empty — then not.` },
]

const FALLBACK_TITLES = [
  'UNLABELED EVIDENCE', 'RECOVERED STILL', 'LEAKED FROM THE DRIVE', 'FOUND IN THE WALL',
  'CAMERA ROLL — DELETED', 'COLD CASE ATTACHMENT', 'PRIVATE FOLDER', 'LAST IMAGE BEFORE',
  'UNSIGNED PRINT', 'SEIZED HARD DRIVE', 'BODY CAM STILL', 'MOTEL CCTV',
]
const FALLBACK_BITS = [
  `No chain of custody. If you recognize the room, leave. If you recognize yourself, it’s already too late.`,
  `EXIF wiped. Geolocation still points at your block. The shadow arrived in the file later.`,
  `Printed on the back: watch with the lights off. People who do report a figure behind them in the screen reflection.`,
  `Part of an unmarked zip. Other files are worse. This one looks back.`,
  `Stains tested theatrical. They weren’t. DNA mixed three people and something that wouldn’t amplify.`,
  `Taken from inside a closet. The person outside is waiting for you to scroll past.`,
  `Artistic nude sitting. The painter’s notes say the model refused to turn around. Something was already facing the canvas.`,
  `Found footage still. Chat typed “behind you” twelve times before the scream.`,
]

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const MEDIA_FILES: string[] = [
  '/media/jumpscare-face.jpg', '/media/crt-scream.jpg', '/media/static-face.jpg',
  '/media/nv-silhouette.jpg', '/media/closet-eyes.jpg', '/media/stair-hand.jpg',
  '/media/mirror-double.jpg', '/media/hall-entity.jpg', '/media/cemetery-open.jpg',
  '/media/forest-eyes.jpg', '/media/hospital-shadow.jpg', '/media/flooded-basement.jpg',
  '/media/playground-fog.jpg', '/media/attic-mirror.jpg', '/media/dining-presence.jpg',
  '/media/void-door.jpg', '/media/archive_2.jpg', '/media/archive_4.jpg',
  '/media/commons_1.jpg', '/media/commons_2.jpg', '/media/commons_3.jpg',
  '/media/commons_4.jpg', '/media/commons_5.jpg',
]

export const HAND_VIDEOS: FeedVid[] = [
  { src: '/video/cam_crypt.webm', label: 'CRYPT' },
  { src: '/video/cam_cellar.webm', label: 'CELLAR' },
  { src: '/video/cam_attic.webm', label: 'ATTIC' },
  { src: '/video/cam_ritual.webm', label: 'RITUAL' },
  { src: '/video/cam_ward.webm', label: 'WARD' },
  { src: '/video/cam_yard.webm', label: 'YARD' },
  { src: '/video/cam_forest.webm', label: 'FOREST' },
  { src: '/video/cam_playground.webm', label: 'PLAYGROUND' },
  { src: '/video/cam_flood.webm', label: 'FLOOD' },
  { src: '/video/cam_mirror.webm', label: 'MIRROR' },
  { src: '/video/cam_nv.webm', label: 'NV' },
  { src: '/video/cam_crt.webm', label: 'CRT' },
  { src: '/video/cam_closet.webm', label: 'CLOSET' },
  { src: '/video/cam_hall.webm', label: 'HALL' },
  { src: '/video/cam_stairs.webm', label: 'STAIRS' },
  { src: '/video/cam_basement.webm', label: 'BASEMENT' },
  { src: '/video/cam_static.webm', label: 'STATIC' },
  { src: '/video/cam_party.webm', label: 'PARTY' },
  { src: '/video/cam_scream.webm', label: 'SCREAM' },
  { src: '/video/cam_dark.webm', label: 'DARK' },
  { src: '/video/cam_chase.webm', label: 'CHASE' },
  { src: '/video/cam_reveal.webm', label: 'REVEAL' },
  { src: '/video/cam_end.webm', label: 'END' },
  { src: '/video/cam_pool.webm', label: 'POOL' },
  { src: '/video/cam_panic.webm', label: 'PANIC' },
]

export const MURDERS: MurderFile[] = [
  { id: 'motel13', title: 'CASE — MOTEL 13', rating: 'R — sex / murder', body: `Checked in to fuck. Lens found the window. Blade. Arterial spray. Bodies posed naked. THANKS FOR THE SHOW in lipstick and blood.` },
  { id: 'wardc', title: 'CASE — WARD C', rating: 'R — drugs / murder', body: `Oxy. Smiles cut into cheeks. Black water in lungs. Jars in the closet labeled with the dead.` },
  { id: 'chat', title: 'CASE — CHAT 04:44', rating: 'R — stalking / murder', body: `Send nudes. Come outside. Second figure folded her into the dark. Killer’s eyes reflect LOOK BACK.` },
  { id: 'forest', title: 'CASE — TRAIL CAM 09', rating: 'R — body horror', body: `Followed by himself from yesterday. Skin on a log. Bones mailed: assembly required.` },
  { id: 'stream', title: 'CASE — PIRATE STREAM', rating: 'R — sex / murder', body: `Couple fucking. Third shape in doorway. Camera flips to your bedroom. Chat: LOL.` },
  { id: 'needle', title: 'CASE — NEEDLE HOUSE', rating: 'R — drugs / murder', body: `Mirror asks for a vein. Yes means the tub. Tracks form a pentagram.` },
  { id: 'altar', title: 'CASE — HARD DRIVE ALTAR', rating: 'R — occult / sex', body: `Blood spit cum stolen IDs. Amen in chat. Wake with USB around the throat.` },
  { id: 'guest', title: 'CASE — HOUSEGUEST', rating: 'R — home invasion', body: `Opened naked. It wore his jacket. Sex became meat. Polaroid of you from outside.` },
  { id: 'bath', title: 'CASE — BATHROOM SITTING', rating: 'R — nudity / murder', body: `Nude pose. Lover already dead in the tub. Timer: sixty frames. Frame forty: wet hand on her shoulder.` },
  { id: 'ride', title: 'CASE — LAST RIDESHARE', rating: 'R — murder / assault', body: `Wrong exit. Body nude in the passenger seat. Driver bio: can i see you.` },
  { id: 'gallery', title: 'CASE — NUDE GALLERY OPENING', rating: 'R — nudity / murder', body: `Models posed live. Lights cut. When they returned one model was posed forever — throat open, smile painted on.` },
  { id: 'church', title: 'CASE — AFTER HOURS MASS', rating: 'R — occult / sexual violence', body: `Congregation of one. Confessional smelled like bleach and perfume. Priest found nude under the altar with communion wine in his lungs.` },
]

const verbs = ['bleed', 'watch', 'carve', 'drain', 'film', 'haunt', 'stalk', 'inject', 'mirror', 'open', 'scream', 'possess', 'undress', 'bury', 'count']
const nouns = ['webcam', 'throat', 'mattress', 'needle', 'guest', 'hallway', 'victim', 'reflection', 'altar', 'motel', 'ward', 'forest', 'nude', 'ossuary', 'feed']

/** 2000+ procedural case scraps for the collage. */
export function buildCaseDump(count = 2200): MurderFile[] {
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

export async function loadAllPhotos(): Promise<PhotoStory[]> {
  let files = MEDIA_FILES
  try {
    const res = await fetch('/media-index.json')
    if (res.ok) {
      const listed: string[] = await res.json()
      if (listed.length) files = listed
    }
  } catch { /* ignore */ }
  return files.map((src, i) => {
    if (i < STORY_BANK.length) return { src, ...STORY_BANK[i] }
    const rnd = mulberry32(0x51a7 ^ i)
    return {
      src,
      title: FALLBACK_TITLES[Math.floor(rnd() * FALLBACK_TITLES.length)] + ` #${i + 1}`,
      rating: rnd() > 0.4 ? 'R — nudity / violence / paranormal' : 'R — violence / paranormal',
      story: FALLBACK_BITS[Math.floor(rnd() * FALLBACK_BITS.length)],
    }
  })
}

export async function loadAllVideos(): Promise<FeedVid[]> {
  try {
    const res = await fetch('/video-index.json')
    if (res.ok) {
      const listed: string[] = await res.json()
      if (listed.length) {
        return listed.map((src, i) => ({
          src,
          label: HAND_VIDEOS[i]?.label || `CAM_${String(i).padStart(2, '0')}`,
        }))
      }
    }
  } catch { /* ignore */ }
  return HAND_VIDEOS
}

/** Tiny preload for a fast loading screen. */
export function preloadSubset(photos: PhotoStory[], _videos: FeedVid[]) {
  const imgs = photos.slice(0, 4).map((p) => p.src)
  return [...imgs, '/sfx/creak.wav']
}
