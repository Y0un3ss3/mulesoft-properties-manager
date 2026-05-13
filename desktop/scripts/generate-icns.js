/**
 * Generates public/icon.icns for macOS from the app SVG.
 * Run on macOS: node scripts/generate-icns.js
 * Requires: npm install --save-dev @resvg/resvg-js (already installed)
 * Uses macOS built-in `iconutil` to assemble the .icns.
 */
const { execSync } = require('child_process')
const { Resvg }    = require('@resvg/resvg-js')
const fs   = require('fs')
const path = require('path')
const os   = require('os')

async function main() {
  const svgPath  = path.join(__dirname, '..', '..', 'favicon.svg')
  const svgData  = fs.readFileSync(svgPath, 'utf8')
  const iconset  = path.join(os.tmpdir(), 'AppIcon.iconset')
  const outPath  = path.join(__dirname, '..', 'public', 'icon.icns')

  fs.mkdirSync(iconset, { recursive: true })

  // macOS iconset requires these specific sizes
  const sizes = [
    { size: 16,   name: 'icon_16x16.png' },
    { size: 32,   name: 'icon_16x16@2x.png' },
    { size: 32,   name: 'icon_32x32.png' },
    { size: 64,   name: 'icon_32x32@2x.png' },
    { size: 128,  name: 'icon_128x128.png' },
    { size: 256,  name: 'icon_128x128@2x.png' },
    { size: 256,  name: 'icon_256x256.png' },
    { size: 512,  name: 'icon_256x256@2x.png' },
    { size: 512,  name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ]

  for (const { size, name } of sizes) {
    const resvg = new Resvg(svgData, { fitTo: { mode: 'width', value: size } })
    const png   = resvg.render().asPng()
    fs.writeFileSync(path.join(iconset, name), png)
    console.log(`  rendered ${name}`)
  }

  execSync(`iconutil -c icns "${iconset}" -o "${outPath}"`)
  fs.rmSync(iconset, { recursive: true, force: true })
  console.log('✓ Written', outPath)
}

main().catch((e) => { console.error(e); process.exit(1) })
