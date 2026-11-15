import { defineConfig, type Plugin } from 'vite'
import { uploadLimitPlugin } from './vite.upload-plugin.mjs'

/**
 * Production-only hard obfuscation.
 * Avoids selfDefending/debugProtection (need Function/eval → break CSP).
 */
function hardObfuscate(): Plugin {
  let obfuscator: typeof import('javascript-obfuscator') | null = null
  return {
    name: 'lookback-hard-obfuscate',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_opts, bundle) {
      if (!obfuscator) obfuscator = await import('javascript-obfuscator')
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !fileName.endsWith('.js')) continue
        const result = obfuscator.default.obfuscate(chunk.code, {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.9,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.4,
          debugProtection: false,
          disableConsoleOutput: true,
          identifierNamesGenerator: 'mangled-shuffled',
          ignoreImports: true,
          numbersToExpressions: true,
          renameGlobals: false,
          selfDefending: false,
          simplify: true,
          splitStrings: true,
          splitStringsChunkLength: 3,
          stringArray: true,
          stringArrayCallsTransform: true,
          stringArrayCallsTransformThreshold: 0.85,
          stringArrayEncoding: ['rc4'],
          stringArrayIndexShift: true,
          stringArrayRotate: true,
          stringArrayShuffle: true,
          stringArrayWrappersCount: 3,
          stringArrayWrappersChainedCalls: true,
          stringArrayWrappersParametersMaxCount: 4,
          stringArrayWrappersType: 'function',
          stringArrayThreshold: 0.95,
          transformObjectKeys: true,
          unicodeEscapeSequence: false,
          target: 'browser',
          seed: 0x10b4c ^ (Date.now() & 0xffff),
        })
        chunk.code = result.getObfuscatedCode()
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [uploadLimitPlugin(), ...(command === 'build' ? [hardObfuscate()] : [])],
  server: {
    host: '127.0.0.1',
    port: 3947,
    strictPort: true,
    fs: {
      deny: [
        '**/vault/**',
        '**/data/**',
        '**/pending-uploads/**',
        '**/server/**',
        '**/.env',
        '**/.env.*',
      ],
    },
  },
  preview: { host: '127.0.0.1', port: 3947, strictPort: true },
  build: {
    sourcemap: false,
    minify: 'terser',
    cssMinify: true,
    target: 'es2020',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
    modulePreload: { polyfill: false },
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 3,
        pure_getters: true,
        unsafe: true,
        unsafe_comps: true,
        booleans_as_integers: true,
      },
      mangle: {
        toplevel: true,
        safari10: true,
      },
      format: {
        comments: false,
        ascii_only: true,
      },
    },
    rollupOptions: {
      output: {
        // meaningless hashed paths — harder to map to source modules
        entryFileNames: 'a/[hash].js',
        chunkFileNames: 'a/[hash].js',
        assetFileNames: 'a/[hash][extname]',
        manualChunks(id) {
          if (id.includes('/data/horror')) return 'd'
          if (id.includes('/audio/haunt')) return 'h'
          if (id.includes('/webcam')) return 'w'
          if (id.includes('/upload')) return 'u'
          return undefined
        },
      },
    },
  },
}))
