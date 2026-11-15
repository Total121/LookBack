/**
 * Submission queue (client-side stub).
 * Files stay pending in IndexedDB until a future admin/backend accepts them.
 * Validates type/size only — no remote exec, no HTML uploads.
 */

const DB = 'lb_submissions'
const STORE = 'pending'
const MAX_BYTES = 12 * 1024 * 1024 // 12MB
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/webm',
  'video/mp4',
  'video/quicktime',
])

export type PendingSub = {
  id: string
  name: string
  type: string
  size: number
  created: number
  status: 'pending'
  /** Object URL for local preview only — not published */
  preview?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function putPending(meta: PendingSub, blob: Blob) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...meta, blob })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function countPending(): Promise<number> {
  try {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return 0
  }
}

function sanitizeName(name: string) {
  return name.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 120)
}

export function validateFile(file: File): string | null {
  if (!ALLOWED.has(file.type)) return 'only jpg/png/webp/gif/webm/mp4'
  if (file.size <= 0 || file.size > MAX_BYTES) return 'max 12MB'
  if (/\.(html?|svg|js|mjs|css|exe|php|sh)$/i.test(file.name)) return 'blocked type'
  return null
}

export async function queueUpload(file: File): Promise<PendingSub> {
  const err = validateFile(file)
  if (err) throw new Error(err)
  const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const meta: PendingSub = {
    id,
    name: sanitizeName(file.name),
    type: file.type,
    size: file.size,
    created: Date.now(),
    status: 'pending',
  }
  await putPending(meta, file)
  return meta
}

export function mountUploadButton(parent: HTMLElement) {
  let btn = parent.querySelector<HTMLButtonElement>('.upload-fab')
  if (btn) return btn
  btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'upload-fab'
  btn.textContent = 'UPLOAD'
  btn.title = 'submit photo/video for review'
  btn.addEventListener('click', () => openUploadModal())
  parent.appendChild(btn)
  return btn
}

function openUploadModal() {
  if (document.querySelector('.upload-modal')) return
  const modal = document.createElement('div')
  modal.className = 'upload-modal'
  modal.innerHTML = `<div class="upload-box">
    <button type="button" class="tear-x" data-x>x</button>
    <h3>SUBMIT</h3>
    <p class="sub">photos or videos · max 12MB · pending until accepted · not public yet</p>
    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/webm,video/mp4,video/quicktime" id="ufile"/>
    <p class="ustatus" id="ustatus"></p>
    <button type="button" class="usubmit" id="usubmit" disabled>queue for review</button>
  </div>`
  document.body.appendChild(modal)

  const input = modal.querySelector<HTMLInputElement>('#ufile')!
  const status = modal.querySelector('#ustatus')!
  const submit = modal.querySelector<HTMLButtonElement>('#usubmit')!
  let file: File | null = null

  const close = () => modal.remove()
  modal.querySelector('[data-x]')!.addEventListener('click', close)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close()
  })

  input.addEventListener('change', () => {
    file = input.files?.[0] || null
    if (!file) {
      submit.disabled = true
      status.textContent = ''
      return
    }
    const err = validateFile(file)
    if (err) {
      file = null
      submit.disabled = true
      status.textContent = err
      return
    }
    submit.disabled = false
    status.textContent = `${sanitizeName(file.name)} · ${(file.size / 1024).toFixed(0)} KB`
  })

  submit.addEventListener('click', async () => {
    if (!file) return
    submit.disabled = true
    status.textContent = 'queuing…'
    try {
      await queueUpload(file)
      const n = await countPending()
      status.textContent = `queued · ${n} pending review`
      file = null
      input.value = ''
      setTimeout(close, 1200)
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'failed'
      submit.disabled = false
    }
  })
}
