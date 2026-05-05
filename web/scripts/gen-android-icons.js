/* eslint-disable no-console */
// Regenerate Android launcher icons from web/public/logo-192.png.
// Outputs:
//   - mipmap-*/ic_launcher.png         (square)
//   - mipmap-*/ic_launcher_round.png   (circle masked)
//   - mipmap-*/ic_launcher_foreground.png (108dp adaptive icon foreground; logo on transparent, ~66% safe zone)
const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'public', 'logo-192.png')
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

// Standard launcher icon sizes per density (square + round).
const LAUNCHER_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
}

// Adaptive icon foreground is 108dp. Per density (px):
const FOREGROUND_SIZES = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
}

// Background color for square icons (matches splash + theme).
const BG_COLOR = { r: 6, g: 10, b: 19, alpha: 1 } // #060a13

async function makeSquare(size, outPath) {
  // Logo fills ~88% of square, centered, on opaque dark background.
  const inner = Math.round(size * 0.88)
  const logo = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG_COLOR },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(outPath)
}

async function makeRound(size, outPath) {
  const inner = Math.round(size * 0.88)
  const logo = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer()
  // Build a circle mask the size of the icon
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`)
  const base = await sharp({ create: { width: size, height: size, channels: 4, background: BG_COLOR } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer()
  await sharp(base)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toFile(outPath)
}

async function makeForeground(size, outPath) {
  // Adaptive foreground: transparent canvas, logo confined to inner 66% safe zone (Android masks/zooms beyond that).
  const inner = Math.round(size * 0.66)
  const logo = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(outPath)
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('Missing source logo:', SRC)
    process.exit(1)
  }
  for (const [dir, size] of Object.entries(LAUNCHER_SIZES)) {
    const target = path.join(RES, dir)
    fs.mkdirSync(target, { recursive: true })
    await makeSquare(size, path.join(target, 'ic_launcher.png'))
    await makeRound(size, path.join(target, 'ic_launcher_round.png'))
    console.log('  ✓', dir, '→ ic_launcher.png + ic_launcher_round.png', `(${size}px)`)
  }
  for (const [dir, size] of Object.entries(FOREGROUND_SIZES)) {
    const target = path.join(RES, dir)
    await makeForeground(size, path.join(target, 'ic_launcher_foreground.png'))
    console.log('  ✓', dir, '→ ic_launcher_foreground.png', `(${size}px)`)
  }
  console.log('\nAll launcher icons regenerated from', path.relative(ROOT, SRC))
}

main().catch((err) => { console.error(err); process.exit(1) })
