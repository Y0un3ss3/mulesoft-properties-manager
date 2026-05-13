/**
 * Embeds icon.ico into the portable exe using resedit.
 * Skipped automatically if the exe is already signed (CI handles icon via winCodeSign).
 */
const path = require('path')
const fs   = require('fs')
const os   = require('os')

async function main() {
  const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit')

  const exePath  = path.join(__dirname, '..', 'release', 'MuleSoft Properties Manager 1.0.0.exe')
  const icoPath  = path.join(__dirname, '..', 'public', 'icon.ico')
  const tmpPath  = path.join(os.tmpdir(), 'mpm-icon-patched.exe')

  if (!fs.existsSync(exePath)) {
    console.error('EXE not found:', exePath)
    process.exit(1)
  }

  // Try to parse — if it fails the exe is already signed (CI path), skip gracefully
  let exe, res
  try {
    exe = NtExecutable.from(fs.readFileSync(exePath))
    res = NtExecutableResource.from(exe)
  } catch (e) {
    if (e.message && e.message.includes('signed')) {
      console.log('ℹ Exe is already signed — skipping icon embed (handled by electron-builder in CI)')
      process.exit(0)
    }
    throw e
  }

  console.log('Reading ico...')
  const icoData  = fs.readFileSync(icoPath)
  const ico      = Data.IconFile.from(icoData)

  // Replace ALL icon groups
  const groups = Resource.IconGroupEntry.fromEntries(res.entries)
  console.log(`  Found ${groups.length} icon group(s): ${groups.map((g) => g.id).join(', ')}`)

  for (const group of groups) {
    Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      ico.icons.map((i) => i.data)
    )
    console.log(`  Patched icon group ${group.id}`)
  }

  res.outputResource(exe)

  console.log('Writing patched exe to temp...')
  const outData = Buffer.from(exe.generate())
  fs.writeFileSync(tmpPath, outData)

  // Wait briefly for any file locks to release
  await new Promise((r) => setTimeout(r, 1500))

  console.log('Replacing original exe...')
  fs.copyFileSync(tmpPath, exePath)
  fs.unlinkSync(tmpPath)

  console.log('✓ Icon embedded into', path.basename(exePath))
}

main().catch((e) => { console.error(e); process.exit(1) })
