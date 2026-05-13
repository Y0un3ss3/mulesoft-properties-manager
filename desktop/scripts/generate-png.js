/**
 * Generates public/icon.png (512x512) for Linux AppImage.
 * node scripts/generate-png.js
 */
const { Resvg } = require('@resvg/resvg-js')
const fs   = require('fs')
const path = require('path')

const svgData = fs.readFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), 'utf8')
const resvg   = new Resvg(svgData, { fitTo: { mode: 'width', value: 512 } })
const png     = resvg.render().asPng()
const outPath = path.join(__dirname, '..', 'public', 'icon.png')
fs.writeFileSync(outPath, png)
console.log('✓ Written', outPath)
