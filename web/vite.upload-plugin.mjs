import { createAppHandler } from './server/app.mjs'

/**
 * Vite plugin: upload API + admin (/alb) in dev and preview.
 * Public Vite app is left to Vite; API/admin are intercepted first.
 */
export function uploadLimitPlugin() {
  const handler = createAppHandler({ isProd: false })

  const attach = (server) => {
    server.middlewares.use((req, res, next) => {
      const url = req.url || ''
      if (
        url.startsWith('/api/') ||
        url.startsWith('/m/') ||
        url === '/alb' ||
        url.startsWith('/alb/') ||
        url.startsWith('/media/') ||
        url.startsWith('/video/') ||
        url.startsWith('/sfx/') ||
        url === '/media-index.json' ||
        url === '/video-index.json'
      ) {
        // opaque media + APIs; block direct vault/public asset leaks in dev
        Promise.resolve(handler(req, res, next)).catch(next)
        return
      }
      next()
    })
  }

  return {
    name: 'lookback-server',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
