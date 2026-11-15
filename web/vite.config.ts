import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: '127.0.0.1', port: 3947, strictPort: true },
  preview: { host: '127.0.0.1', port: 3947, strictPort: true },
  build: {
    sourcemap: false,
    cssMinify: true,
    target: 'es2020',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        entryFileNames: 'a/[hash].js',
        chunkFileNames: 'a/[hash].js',
        assetFileNames: 'a/[hash][extname]',
      },
    },
  },
})
