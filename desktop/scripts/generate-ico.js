/**
 * Generates a Windows .ico file from the app SVG using the Canvas API
 * built into Electron's Node.js environment (via the `canvas` npm package
 * if available, otherwise falls back to a pure-JS PNG encoder).
 *
 * We use a simpler approach: generate PNG buffers at 16, 32, 48, 256px
 * using the `sharp` or `jimp` approach — but since we want zero extra deps,
 * we'll write the ICO directly by rendering the SVG shapes as raw pixel data.
 *
 * Actually the simplest zero-dep approach on Windows:
 * Use the built-in `mshta` / PowerShell to convert, OR just embed a
 * hand-crafted ICO from the SVG geometry.
 *
 * We'll use the `png-to-ico` npm package which is already available via
 * electron-builder's deps, or install it as a dev dep.
 */

// This script is run via: node scripts/generate-ico.js
// It requires: npm install --save-dev png-to-ico @resvg/resvg-js

const fs   = require('fs')
const path = require('path')

async function main() {
  // Try to use @resvg/resvg-js to rasterise the SVG
  let Resvg
  try {
    Resvg = require('@resvg/resvg-js').Resvg
  } catch {
    console.error('Missing dep: npm install --save-dev @resvg/resvg-js png-to-ico')
    process.exit(1)
  }

  const pngToIco = require('png-to-ico')

  const svgPath = path.join(__dirname, '..', '..', 'favicon.svg')
  const svgData = fs.readFileSync(svgPath, 'utf8')
  const outDir  = path.join(__dirname, '..', 'public')
  fs.mkdirSync(outDir, { recursive: true })

  const sizes = [16, 32, 48, 256]
  const pngBuffers = []

  for (const size of sizes) {
    const resvg = new Resvg(svgData, {
      fitTo: { mode: 'width', value: size },
    })
    const rendered = resvg.render()
    pngBuffers.push(rendered.asPng())
    console.log(`  rendered ${size}x${size}`)
  }

  const icoBuffer = await pngToIco(pngBuffers)
  const outPath = path.join(outDir, 'icon.ico')
  fs.writeFileSync(outPath, icoBuffer)
  console.log(`✓ Written ${outPath} (${icoBuffer.length} bytes)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
