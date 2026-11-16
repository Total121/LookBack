import { createAppHandler, config } from './server/app.mjs'

/**
 * Vite plugin: upload API + admin UI in dev and preview.
 * Public Vite app is left to Vite; API/admin are intercepted first.
 */
export function uploadLimitPlugin() {
  const handler = createAppHandler({ isProd: false })
  const adminBase = config.adminPath

  const attach = (server) => {
    server.middlewares.use((req, res, next) => {
      const url = req.url || ''
      if (
        url.startsWith('/api/') ||
        url.startsWith('/m/') ||
        url === adminBase ||
        url.startsWith(adminBase + '/') ||
        url.startsWith('/media/') ||
        url.startsWith('/video/') ||
        url.startsWith('/sfx/') ||
        url === '/media-index.json' ||
        url === '/video-index.json'
      ) {
        Promise.resolve(handler(req, res, next)).catch(next)
        return
      }
      next()
    })
  }

  return {
    name: 'app-server',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
