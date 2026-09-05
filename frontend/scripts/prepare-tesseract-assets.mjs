import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const assets = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/tesseract/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'public/tesseract/core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'public/tesseract/core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'public/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/tesseract/lang/eng.traineddata.gz'],
]

async function digest(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

async function copyIfChanged(sourcePath, destinationPath) {
  let sourceStats
  try {
    sourceStats = await stat(sourcePath)
  } catch {
    throw new Error(`Required Tesseract asset is missing: ${sourcePath}`)
  }

  let unchanged = false
  try {
    const destinationStats = await stat(destinationPath)
    unchanged = sourceStats.size === destinationStats.size
      && await digest(sourcePath) === await digest(destinationPath)
  } catch {
    unchanged = false
  }

  if (!unchanged) {
    await mkdir(path.dirname(destinationPath), { recursive: true })
    await copyFile(sourcePath, destinationPath)
  }

  return { copied: !unchanged, size: sourceStats.size }
}

let copied = 0
let totalBytes = 0
for (const [source, destination] of assets) {
  const result = await copyIfChanged(
    path.join(frontendRoot, source),
    path.join(frontendRoot, destination),
  )
  if (result.copied) copied += 1
  totalBytes += result.size
}

console.log(`Tesseract assets ready: ${assets.length} files, ${copied} copied, ${totalBytes} bytes total.`)
