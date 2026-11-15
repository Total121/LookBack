/**
 * Hard-obfuscate admin UI JS so /alb source is not readable.
 * Writes admin.obf.js next to admin.js (served preferentially).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JavaScriptObfuscator from 'javascript-obfuscator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(__dirname, '..', 'server', 'admin-ui', 'admin.js')
const out = path.join(__dirname, '..', 'server', 'admin-ui', 'admin.obf.js')

const code = fs.readFileSync(src, 'utf8')
const result = JavaScriptObfuscator.obfuscate(code, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.25,
  debugProtection: false,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'mangled-shuffled',
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 4,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['rc4'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.9,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  target: 'browser',
  seed: 0xa1b01,
})
fs.writeFileSync(out, result.getObfuscatedCode())
console.log('obfuscated admin →', path.relative(process.cwd(), out))
