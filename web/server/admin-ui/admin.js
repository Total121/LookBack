const app = document.getElementById('app')

/** @type {{ authenticated: boolean, user?: string, csrf?: string, config?: any }} */
let state = { authenticated: false }
let tab = 'pending'
let pending = []
let library = []
let reactions = []
let bans = []
let auditLog = []
let settings = null
let health = null
let stats = null
let query = ''
let turnstileWidgetId = null
let flash = ''

const MAX_CHARS = 2000

function chars(text) {
  return Array.from(String(text || '')).length
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  if (state.csrf && opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = state.csrf
  const res = await fetch(path, {
    ...opts,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (res.status === 401 && path !== '/api/admin/session' && path !== '/api/admin/login') {
    state = { authenticated: false, config: state.config }
    render()
  }
  return { res, data }
}

function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v === false || v == null) continue
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids) {
    if (kid == null || kid === false) continue
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return node
}

function mountTurnstile(slot, siteKey) {
  slot.replaceChildren()
  if (!siteKey || !window.turnstile) {
    slot.append(
      el('div', {
        className: 'meta',
        text: siteKey ? 'Loading Turnstile…' : 'Turnstile disabled (REQUIRE_TURNSTILE=false)',
      }),
    )
    return null
  }
  return window.turnstile.render(slot, {
    sitekey: siteKey,
    theme: 'dark',
  })
}

function renderLogin() {
  app.replaceChildren()
  const err = el('p', { className: 'err', id: 'login-err' })
  const user = el('input', { type: 'text', id: 'user', autocomplete: 'username', spellcheck: 'false' })
  const pass = el('input', { type: 'password', id: 'pass', autocomplete: 'current-password' })
  const slot = el('div', { className: 'turnstile-slot', id: 'ts' })
  const btn = el('button', { className: 'btn btn-primary', type: 'button', text: 'Enter' })

  const card = el('div', { className: 'login-card' }, [
    el('div', { className: 'eyebrow', text: 'Restricted' }),
    el('h1', { text: 'ALB' }),
    el('p', {
      className: 'sub',
      text: 'Moderator access only. Sessions are HttpOnly, CSRF-bound, and rate-limited. Cloudflare Turnstile required when configured.',
    }),
    err,
    el('div', { className: 'field' }, [el('label', { text: 'Username' }), user]),
    el('div', { className: 'field' }, [el('label', { text: 'Password' }), pass]),
    slot,
    btn,
  ])

  app.append(el('div', { className: 'login-wrap' }, [card]))

  const siteKey = state.config?.turnstileSiteKey
  const bootTs = () => {
    turnstileWidgetId = mountTurnstile(slot, siteKey)
  }
  if (window.turnstile) bootTs()
  else {
    const t = setInterval(() => {
      if (window.turnstile) {
        clearInterval(t)
        bootTs()
      }
    }, 200)
    setTimeout(() => clearInterval(t), 8000)
  }

  const submit = async () => {
    err.textContent = ''
    btn.disabled = true
    let token = ''
    if (state.config?.requireTurnstile && window.turnstile && turnstileWidgetId != null) {
      token = window.turnstile.getResponse(turnstileWidgetId) || ''
      if (!token) {
        err.textContent = 'Complete the bot check'
        btn.disabled = false
        return
      }
    }
    const { res, data } = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: user.value,
        password: pass.value,
        turnstileToken: token,
      }),
    })
    btn.disabled = false
    if (!res.ok || !data?.ok) {
      err.textContent = data?.error || 'login failed'
      if (window.turnstile && turnstileWidgetId != null) window.turnstile.reset(turnstileWidgetId)
      return
    }
    state = {
      authenticated: true,
      user: data.user,
      csrf: data.csrf,
      config: data.config || state.config,
    }
    flash = ''
    await refreshAll()
    render()
  }

  btn.addEventListener('click', () => void submit())
  pass.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submit()
  })
}

function descField(value, onInput) {
  const ta = el('textarea', { maxlength: '4000' })
  ta.value = value || ''
  ta.maxLength = String(MAX_CHARS)
  const counter = el('div', { className: 'wordcount' })
  const sync = () => {
    const n = chars(ta.value)
    counter.textContent = `${n} / ${MAX_CHARS} characters`
    counter.classList.toggle('bad', n > MAX_CHARS)
    onInput?.(ta.value, n)
  }
  ta.addEventListener('input', sync)
  sync()
  return {
    ta,
    counter,
    wrap: el('div', {}, [
      el('label', { text: 'Description' }),
      el('div', {
        className: 'meta',
        text: 'Where it is from, what happened, why it is paranormal. No personal contact info.',
      }),
      ta,
      counter,
    ]),
  }
}

function pendingCard(item) {
  const isVideo = String(item.type || '').startsWith('video/')
  const media = el('div', { className: 'card-media' }, [
    el('div', { className: 'badge pending', text: 'Pending' }),
  ])
  if (isVideo) {
    media.append(
      el('video', {
        src: item.previewUrl,
        controls: true,
        preload: 'metadata',
      }),
    )
  } else {
    media.append(el('img', { src: item.previewUrl, alt: '' }))
  }

  const title = el('input', { value: item.name || '', maxlength: '160' })
  title.value = item.name || ''
  const rating = el('input', { value: 'R — community submit', maxlength: '80' })
  rating.value = 'R — community submit'
  const { ta, wrap: descWrap } = descField(item.description || '', () => {})

  const status = el('p', { className: 'err' })
  const accept = el('button', { className: 'btn btn-ok', type: 'button', text: 'Accept' })
  const deny = el('button', { className: 'btn btn-danger', type: 'button', text: 'Deny' })

  accept.addEventListener('click', async () => {
    status.textContent = ''
    status.className = 'err'
    if (chars(ta.value.trim()) < 1) {
      status.textContent = 'description required'
      return
    }
    if (chars(ta.value) > MAX_CHARS) {
      status.textContent = `max ${MAX_CHARS} characters`
      return
    }
    accept.disabled = true
    deny.disabled = true
    const { res, data } = await api(`/api/admin/pending/${encodeURIComponent(item.id)}/accept`, {
      method: 'POST',
      body: JSON.stringify({
        title: title.value,
        description: ta.value,
        rating: rating.value,
      }),
    })
    if (!res.ok || !data?.ok) {
      status.textContent = data?.error || 'accept failed'
      accept.disabled = false
      deny.disabled = false
      return
    }
    flash = `Accepted ${data.accepted?.src || item.id}`
    await refreshAll()
    render()
  })

  deny.addEventListener('click', async () => {
    if (!confirm(`Deny and delete ${item.name}?`)) return
    accept.disabled = true
    deny.disabled = true
    const { res, data } = await api(`/api/admin/pending/${encodeURIComponent(item.id)}/deny`, {
      method: 'POST',
      body: '{}',
    })
    if (!res.ok || !data?.ok) {
      status.textContent = data?.error || 'deny failed'
      accept.disabled = false
      deny.disabled = false
      return
    }
    flash = `Denied ${item.id}`
    await refreshAll()
    render()
  })

  return el('article', { className: 'card' }, [
    media,
    el('div', { className: 'card-body' }, [
      el('div', { className: 'field' }, [el('label', { text: 'Title' }), title]),
      el('div', { className: 'field' }, [el('label', { text: 'Rating' }), rating]),
      el('div', { className: 'field' }, [descWrap]),
      el('div', { className: 'meta' }, [
        el('div', {}, [el('strong', { text: 'IP' }), ` ${item.ip || '—'}`]),
        item.ipHash
          ? el('div', {}, [el('strong', { text: 'IP hash' }), ` ${item.ipHash}`])
          : null,
        el('div', {}, [
          el('strong', { text: 'When' }),
          ` ${item.created ? new Date(item.created).toLocaleString() : '—'}`,
        ]),
        el('div', {}, [el('strong', { text: 'Type' }), ` ${item.type || '—'} · ${Math.round((item.size || 0) / 1024)} KB`]),
        el('div', {}, [el('strong', { text: 'File' }), ` ${item.name || '—'}`]),
        el('div', {}, [el('strong', { text: 'ID' }), ` ${item.id}`]),
      ]),
      status,
      el('div', { className: 'card-actions' }, [accept, deny]),
    ]),
  ])
}

function libraryCard(item) {
  const isVideo = item.kind === 'video' || item.src?.startsWith('/video/')
  const media = el('div', { className: 'card-media' }, [
    el('div', {
      className: `badge ${item.source === 'accepted' ? 'accepted' : ''}`,
      text: item.source === 'accepted' ? 'Accepted' : 'Library',
    }),
  ])
  const preview =
    item.previewUrl || `/api/admin/library/file?src=${encodeURIComponent(item.src || '')}`
  if (isVideo) {
    media.append(el('video', { src: preview, controls: true, preload: 'metadata', muted: true }))
  } else {
    media.append(el('img', { src: preview, alt: '', loading: 'lazy' }))
  }

  const title = el('input', { maxlength: '160' })
  title.value = item.title || ''
  const rating = el('input', { maxlength: '80' })
  rating.value = item.rating || ''
  const { ta, wrap: descWrap } = descField(item.description || '', () => {})
  const status = el('p', { className: 'okmsg' })
  const save = el('button', { className: 'btn btn-primary', type: 'button', text: 'Save', style: 'width:auto' })
  const del = el('button', { className: 'btn btn-danger', type: 'button', text: 'Delete' })
  const hide = el('button', {
    className: 'btn',
    type: 'button',
    text: item.hidden ? 'Unhide' : 'Hide',
  })
  const feature = el('button', {
    className: 'btn',
    type: 'button',
    text: item.featured || item.source === 'accepted' ? 'Unfeature' : 'Feature',
  })

  save.addEventListener('click', async () => {
    status.textContent = ''
    status.className = 'err'
    if (chars(ta.value) > MAX_CHARS) {
      status.textContent = `max ${MAX_CHARS} characters`
      return
    }
    save.disabled = true
    del.disabled = true
    const { res, data } = await api('/api/admin/library', {
      method: 'PATCH',
      body: JSON.stringify({
        src: item.src,
        title: title.value,
        description: ta.value,
        rating: rating.value,
      }),
    })
    save.disabled = false
    del.disabled = false
    if (!res.ok || !data?.ok) {
      status.textContent = data?.error || 'save failed'
      return
    }
    status.className = 'okmsg'
    status.textContent = 'Saved'
    item.title = title.value
    item.description = ta.value
    item.rating = rating.value
  })

  del.addEventListener('click', async () => {
    status.textContent = ''
    status.className = 'err'
    const label = item.title || item.src
    if (
      !confirm(
        `Delete permanently?\n\n${label}\n${item.src}\n\nThis removes the file from the library and cannot be undone.`,
      )
    ) {
      return
    }
    save.disabled = true
    del.disabled = true
    const { res, data } = await api('/api/admin/library', {
      method: 'DELETE',
      body: JSON.stringify({ src: item.src }),
    })
    if (!res.ok || !data?.ok) {
      status.textContent = data?.error || 'delete failed'
      save.disabled = false
      del.disabled = false
      return
    }
    flash = `Deleted ${item.src}`
    await refreshAll()
    render()
  })

  hide.addEventListener('click', async () => {
    await api('/api/admin/library/hide', {
      method: 'POST',
      body: JSON.stringify({ src: item.src, hidden: !item.hidden }),
    })
    flash = `${item.hidden ? 'Unhid' : 'Hid'} ${item.src}`
    await refreshAll()
    render()
  })
  feature.addEventListener('click', async () => {
    const featured = !(item.featured || item.source === 'accepted')
    await api('/api/admin/library/feature', {
      method: 'POST',
      body: JSON.stringify({ src: item.src, featured }),
    })
    flash = `${featured ? 'Featured' : 'Unfeatured'} ${item.src}`
    await refreshAll()
    render()
  })

  return el('article', { className: 'card' }, [
    media,
    el('div', { className: 'card-body' }, [
      el('div', { className: 'field' }, [el('label', { text: 'Title' }), title]),
      el('div', { className: 'field' }, [el('label', { text: 'Rating' }), rating]),
      el('div', { className: 'field' }, [descWrap]),
      el('div', { className: 'meta' }, [
        el('div', {}, [el('strong', { text: 'Path' }), ` ${item.src}`]),
        item.uploaderIp
          ? el('div', {}, [el('strong', { text: 'Uploader IP' }), ` ${item.uploaderIp}`])
          : null,
        item.uploadedAt
          ? el('div', {}, [
              el('strong', { text: 'Uploaded' }),
              ` ${new Date(item.uploadedAt).toLocaleString()}`,
            ])
          : null,
        item.acceptedAt
          ? el('div', {}, [
              el('strong', { text: 'Accepted' }),
              ` ${new Date(item.acceptedAt).toLocaleString()}`,
            ])
          : null,
        item.originalName
          ? el('div', {}, [el('strong', { text: 'Original' }), ` ${item.originalName}`])
          : null,
      ]),
      status,
      el('div', { className: 'card-actions' }, [save, hide, feature, del]),
    ]),
  ])
}

function filterList(items) {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((it) => {
    const hay = [
      it.src,
      it.title,
      it.name,
      it.description,
      it.ip,
      it.uploaderIp,
      it.rating,
      it.id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

function renderDashboard() {
  app.replaceChildren()
  const shell = el('div', { className: 'app-shell' })

  const top = el('header', { className: 'topbar' }, [
    el('div', { className: 'brand' }, ['LOOK BACK · ', el('span', { text: 'ALB' })]),
    el('div', { className: 'top-actions' }, [
      el('div', { className: 'user-pill', text: state.user || 'admin' }),
      el('button', {
        className: 'btn btn-ghost',
        type: 'button',
        text: 'Reindex',
        onClick: async () => {
          const { res, data } = await api('/api/admin/reindex', { method: 'POST', body: '{}' })
          flash = res.ok ? `Reindexed · ${data?.stats?.photos || 0} photos · ${data?.stats?.videos || 0} videos` : data?.error || 'reindex failed'
          await refreshAll()
          render()
        },
      }),
      el('button', {
        className: 'btn btn-danger',
        type: 'button',
        text: 'Logout',
        onClick: async () => {
          await api('/api/admin/logout', { method: 'POST', body: '{}' })
          state = { authenticated: false, config: state.config }
          render()
        },
      }),
    ]),
  ])

  const main = el('main', { className: 'main' })
  if (flash) main.append(el('p', { className: 'okmsg', text: flash }))

  main.append(
    el('div', { className: 'stats' }, [
      el('div', { className: 'stat' }, [
        el('div', { className: 'n', text: String(stats?.pending ?? pending.length) }),
        el('div', { className: 'l', text: 'Pending' }),
      ]),
      el('div', { className: 'stat' }, [
        el('div', { className: 'n', text: String(stats?.reactions ?? reactions.length) }),
        el('div', { className: 'l', text: 'Reactions' }),
      ]),
      el('div', { className: 'stat' }, [
        el('div', { className: 'n', text: String(stats?.accepted ?? 0) }),
        el('div', { className: 'l', text: 'Accepted' }),
      ]),
      el('div', { className: 'stat' }, [
        el('div', { className: 'n', text: String(stats?.banned ?? bans.length) }),
        el('div', { className: 'l', text: 'Banned IPs' }),
      ]),
    ]),
  )

  const tabDefs = [
    ['pending', `Pending (${pending.length})`],
    ['library', `Library (${library.length})`],
    ['reactions', `Reactions (${reactions.length})`],
    ['ops', 'Ops / Settings'],
    ['bans', `Bans (${bans.length})`],
    ['audit', 'Audit'],
  ]
  const tabs = el(
    'div',
    { className: 'tabs' },
    tabDefs.map(([id, label]) =>
      el('button', {
        className: `tab ${tab === id ? 'active' : ''}`,
        type: 'button',
        text: label,
        onClick: () => {
          tab = id
          render()
        },
      }),
    ),
  )
  main.append(tabs)

  const search = el('input', {
    className: 'search',
    placeholder: 'Search title, description, IP, path…',
    value: query,
  })
  search.value = query
  search.addEventListener('input', () => {
    query = search.value
    renderList()
  })
  main.append(
    el('div', { className: 'toolbar' }, [
      search,
      el('button', {
        className: 'btn',
        type: 'button',
        text: 'Refresh',
        onClick: async () => {
          flash = ''
          await refreshAll()
          render()
        },
      }),
    ]),
  )

  const listHost = el('div', { id: 'list-host' })
  main.append(listHost)

  function reactionCard(item) {
    const del = el('button', { className: 'btn btn-danger', type: 'button', text: 'Delete' })
    const ban = el('button', { className: 'btn', type: 'button', text: 'Ban IP' })
    del.addEventListener('click', async () => {
      if (!confirm('Delete this reaction clip?')) return
      await api('/api/admin/reactions', { method: 'DELETE', body: JSON.stringify({ id: item.id }) })
      flash = `Deleted reaction ${item.id}`
      await refreshAll()
      render()
    })
    ban.addEventListener('click', async () => {
      if (!item.ip) return
      await api('/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({ ip: item.ip, reason: 'webcam reaction' }),
      })
      flash = `Banned ${item.ip}`
      await refreshAll()
      render()
    })
    return el('article', { className: 'card' }, [
      el('div', { className: 'card-media' }, [
        el('div', { className: 'badge pending', text: 'Reaction' }),
        el('video', {
          src: item.previewUrl,
          controls: true,
          preload: 'metadata',
        }),
      ]),
      el('div', { className: 'card-body' }, [
        el('div', { className: 'meta' }, [
          el('div', {}, [el('strong', { text: 'IP' }), ` ${item.ip || '—'}`]),
          el('div', {}, [el('strong', { text: 'Reason' }), ` ${item.reason || '—'}`]),
          el('div', {}, [el('strong', { text: 'Dread' }), ` ${item.dread ?? '—'}`]),
          el('div', {}, [
            el('strong', { text: 'When' }),
            ` ${item.created ? new Date(item.created).toLocaleString() : '—'}`,
          ]),
          el('div', {}, [el('strong', { text: 'Size' }), ` ${Math.round((item.size || 0) / 1024)} KB`]),
        ]),
        el('div', { className: 'card-actions' }, [del, ban]),
      ]),
    ])
  }

  function opsPanel() {
    const box = el('div', { className: 'ops-panel' })
    const s = settings || {}
    const row = (label, btnLabel, fn, danger = false) =>
      el('div', { className: 'ops-row' }, [
        el('div', { className: 'meta', text: label }),
        el('button', {
          className: danger ? 'btn btn-danger' : 'btn',
          type: 'button',
          text: btnLabel,
          onClick: () => void fn(),
        }),
      ])

    const run = async (path, method, body, okMsg) => {
      const { res, data } = await api(path, {
        method,
        body: body != null ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
      })
      flash = res.ok ? okMsg(data) : data?.error || 'failed'
      await refreshAll()
      render()
    }

    const dread = el('input', { type: 'number', step: '0.05', min: '0.25', max: '2' })
    dread.value = String(s.dreadMultiplier ?? 1)
    const announce = el('textarea')
    announce.value = s.announcement || ''
    const maintMsg = el('textarea')
    maintMsg.value = s.maintenanceMessage || ''
    const uploadMax = el('input', { type: 'number', min: '1', max: '20' })
    uploadMax.value = String(s.maxUploadsPerWindow ?? 5)
    const retention = el('input', { type: 'number', min: '1', max: '365' })
    retention.value = String(s.reactionRetentionDays ?? 30)

    box.append(
      el('h3', { text: 'Site controls' }),
      row(
        `Uploads: ${s.uploadsEnabled ? 'ON' : 'OFF'}`,
        'Toggle uploads',
        () => run('/api/admin/ops/toggle-uploads', 'POST', {}, (d) => `uploads → ${d.settings?.uploadsEnabled}`),
      ),
      row(
        `Reactions: ${s.reactionsEnabled ? 'ON' : 'OFF'}`,
        'Toggle reactions',
        () =>
          run('/api/admin/ops/toggle-reactions', 'POST', {}, (d) => `reactions → ${d.settings?.reactionsEnabled}`),
      ),
      row(
        `Ambient haunt: ${s.ambientHaunt ? 'ON' : 'OFF'}`,
        'Toggle ambient',
        () => run('/api/admin/ops/toggle-ambient', 'POST', {}, (d) => `ambient → ${d.settings?.ambientHaunt}`),
      ),
      row(
        `Maintenance: ${s.maintenanceMode ? 'ON' : 'OFF'}`,
        'Toggle maintenance',
        () =>
          run('/api/admin/ops/toggle-maintenance', 'POST', {}, (d) => `maintenance → ${d.settings?.maintenanceMode}`),
        true,
      ),
      row('Rebuild media indexes', 'Reindex', () =>
        run('/api/admin/reindex', 'POST', {}, (d) => `reindexed ${d.stats?.photos}/${d.stats?.videos}`),
      ),
      row('Export full catalog JSON', 'Export', async () => {
        const { res, data } = await api('/api/admin/library/export')
        if (!res.ok) {
          flash = data?.error || 'export failed'
          render()
          return
        }
        const blob = new Blob([JSON.stringify(data.catalog, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'lookback-catalog.json'
        a.click()
        flash = 'Catalog exported'
        render()
      }),
      row('Purge all pending uploads', 'Purge pending', () => {
        if (!confirm('Delete ALL pending uploads?')) return
        return run('/api/admin/pending/purge', 'POST', {}, (d) => `purged ${d.removed} pending`)
      }, true),
      row('Purge pending older than 7 days', 'Purge old pending', () =>
        run('/api/admin/pending/purge', 'POST', { olderThanDays: 7 }, (d) => `purged ${d.removed}`),
      ),
      row('Purge old webcam reactions', 'Purge reactions', () =>
        run('/api/admin/reactions/purge', 'POST', {}, (d) => `removed ${d.removed} reactions`),
      ),
      row('Delete ALL accepted community media', 'Purge accepted', () => {
        if (!confirm('Permanently delete every accepted upload from the library?')) return
        return run('/api/admin/library/purge-accepted', 'POST', {}, (d) => `removed ${d.removed}`)
      }, true),
      el('h3', { text: 'Dread / messaging' }),
      el('div', { className: 'field' }, [el('label', { text: 'Dread multiplier (0.25–2)' }), dread]),
      el('div', { className: 'field' }, [el('label', { text: 'Announcement banner' }), announce]),
      el('div', { className: 'field' }, [el('label', { text: 'Maintenance message' }), maintMsg]),
      el('div', { className: 'field' }, [el('label', { text: 'Max uploads / 5 min / IP' }), uploadMax]),
      el('div', { className: 'field' }, [
        el('label', { text: 'Reaction retention (days)' }),
        retention,
      ]),
      el('button', {
        className: 'btn btn-ok',
        type: 'button',
        text: 'Save settings',
        onClick: () =>
          void run(
            '/api/admin/settings',
            'PATCH',
            {
              dreadMultiplier: Number(dread.value),
              announcement: announce.value,
              maintenanceMessage: maintMsg.value,
              maxUploadsPerWindow: Number(uploadMax.value),
              reactionRetentionDays: Number(retention.value),
            },
            () => 'settings saved',
          ),
      }),
      el('h3', { text: 'Health' }),
      el('div', {
        className: 'meta',
        text: health
          ? `media ${health.mediaCount} · video ${health.videoCount} · pending ${health.pendingCount} · reactions ${health.reactionCount} · catalog ${health.catalogItems} · rss ${health.memoryMB}MB · up ${health.uptimeSec}s · ${health.node}`
          : 'loading…',
      }),
    )
    return box
  }

  function renderList() {
    listHost.replaceChildren()
    if (tab === 'ops') {
      listHost.append(opsPanel())
      return
    }
    if (tab === 'audit') {
      if (!auditLog.length) {
        listHost.append(el('div', { className: 'empty', text: 'No audit events.' }))
        return
      }
      const grid = el('div', { className: 'grid' })
      for (const item of auditLog) {
        grid.append(
          el('article', { className: 'card' }, [
            el('div', { className: 'card-body' }, [
              el('div', { className: 'meta' }, [
                el('div', {}, [el('strong', { text: 'Action' }), ` ${item.action}`]),
                el('div', {}, [
                  el('strong', { text: 'When' }),
                  ` ${item.at ? new Date(item.at).toLocaleString() : '—'}`,
                ]),
                el('div', {}, [
                  el('strong', { text: 'Detail' }),
                  ` ${JSON.stringify(item.detail || {})}`,
                ]),
              ]),
            ]),
          ]),
        )
      }
      listHost.append(grid)
      return
    }
    if (tab === 'bans') {
      const banInput = el('input', { className: 'search', placeholder: 'IP to ban' })
      const reason = el('input', { className: 'search', placeholder: 'Reason' })
      listHost.append(
        el('div', { className: 'toolbar' }, [
          banInput,
          reason,
          el('button', {
            className: 'btn btn-danger',
            type: 'button',
            text: 'Ban IP',
            onClick: async () => {
              await api('/api/admin/bans', {
                method: 'POST',
                body: JSON.stringify({ ip: banInput.value.trim(), reason: reason.value.trim() }),
              })
              flash = `Banned ${banInput.value.trim()}`
              await refreshAll()
              render()
            },
          }),
        ]),
      )
      if (!bans.length) {
        listHost.append(el('div', { className: 'empty', text: 'No bans.' }))
        return
      }
      const grid = el('div', { className: 'grid' })
      for (const item of bans) {
        grid.append(
          el('article', { className: 'card' }, [
            el('div', { className: 'card-body' }, [
              el('div', { className: 'meta' }, [
                el('div', {}, [el('strong', { text: 'IP' }), ` ${item.ip}`]),
                el('div', {}, [el('strong', { text: 'Reason' }), ` ${item.reason || '—'}`]),
                el('div', {}, [
                  el('strong', { text: 'When' }),
                  ` ${item.at ? new Date(item.at).toLocaleString() : '—'}`,
                ]),
              ]),
              el('div', { className: 'card-actions' }, [
                el('button', {
                  className: 'btn',
                  type: 'button',
                  text: 'Unban',
                  onClick: async () => {
                    await api('/api/admin/bans', {
                      method: 'DELETE',
                      body: JSON.stringify({ ip: item.ip }),
                    })
                    flash = `Unbanned ${item.ip}`
                    await refreshAll()
                    render()
                  },
                }),
              ]),
            ]),
          ]),
        )
      }
      listHost.append(grid)
      return
    }

    const source =
      tab === 'pending' ? pending : tab === 'library' ? library : tab === 'reactions' ? reactions : []
    const items = filterList(source)
    if (!items.length) {
      listHost.append(
        el('div', {
          className: 'empty',
          text:
            tab === 'pending'
              ? 'No pending uploads.'
              : tab === 'reactions'
                ? 'No webcam reactions yet.'
                : 'No library matches.',
        }),
      )
      return
    }
    const grid = el('div', { className: 'grid' })
    for (const item of items) {
      grid.append(
        tab === 'pending' ? pendingCard(item) : tab === 'reactions' ? reactionCard(item) : libraryCard(item),
      )
    }
    listHost.append(grid)
  }

  renderList()
  shell.append(top, main)
  app.append(shell)
}

function render() {
  if (!state.authenticated) renderLogin()
  else renderDashboard()
}

async function refreshAll() {
  const [p, l, s, r, b, a, set, h] = await Promise.all([
    api('/api/admin/pending'),
    api('/api/admin/library'),
    api('/api/admin/stats'),
    api('/api/admin/reactions'),
    api('/api/admin/bans'),
    api('/api/admin/audit'),
    api('/api/admin/settings'),
    api('/api/admin/health'),
  ])
  if (p.data?.ok) pending = p.data.items || []
  if (l.data?.ok) library = l.data.items || []
  if (s.data?.ok) stats = s.data
  if (r.data?.ok) reactions = r.data.items || []
  if (b.data?.ok) bans = b.data.items || []
  if (a.data?.ok) auditLog = a.data.items || []
  if (set.data?.ok) settings = set.data.settings
  if (h.data?.ok) health = h.data.health
}

async function boot() {
  const { res, data } = await api('/api/admin/session')
  if (res.ok && data?.authenticated) {
    state = {
      authenticated: true,
      user: data.user,
      csrf: data.csrf,
      config: data.config,
    }
    await refreshAll()
  } else {
    state = { authenticated: false, config: data?.config || (await api('/api/public/config')).data }
  }
  render()
}

void boot()
