const fs = require('fs')
const path = require('path')

const files = [
  'services/game/noopLogger.ts',
  'services/game/relatedArtistsDb.ts',
  'services/game/selfHealing.ts'
]

files.forEach((f) => {
  const p = path.join(process.cwd(), f)
  try {
    const buffer = fs.readFileSync(p)
    console.log(`Hex dump of ${f} (first 20 bytes):`)
    console.log(buffer.slice(0, 20).toString('hex'))
  } catch (e) {
    console.error(`Error reading ${f}:`, e)
  }
})
