/**
 * Production server — public site + uploads + /alb admin.
 * Usage: node server/index.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import { createAppHandler, config } from './app.mjs'
import { purgeOldReactions } from './reactions.mjs'

if (!fs.existsSync(config.distDir)) {
  console.error('Missing dist/. Run npm run build first.')
  process.exit(1)
}

const handler = createAppHandler({ isProd: true })
const server = http.createServer((req, res) => {
  void handler(req, res)
})

server.requestTimeout = 120_000
server.headersTimeout = 60_000
server.keepAliveTimeout = 10_000

server.listen(config.port, config.host, () => {
  console.log(`LOOK BACK listening on ${config.host}:${config.port}`)
  console.log(`Admin panel path: /alb`)
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`Public URL: ${process.env.RENDER_EXTERNAL_URL}`)
  }
})

// Auto-purge old webcam reactions on a schedule
try {
  purgeOldReactions()
} catch {
  /* ignore */
}
setInterval(() => {
  try {
    purgeOldReactions()
  } catch {
    /* ignore */
  }
}, 6 * 60 * 60 * 1000).unref?.()

process.on('uncaughtException', (err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
process.on('unhandledRejection', (err) => {
  console.error('[rejection]', err)
})
