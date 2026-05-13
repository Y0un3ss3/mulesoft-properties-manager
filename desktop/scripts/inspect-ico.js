// Inspect icon group IDs in the exe
const { NtExecutable, NtExecutableResource, Resource } = require('resedit')
const fs   = require('fs')
const path = require('path')

const exePath = path.join(__dirname, '..', 'release', 'MuleSoft Properties Manager 1.0.0.exe')
const exe = NtExecutable.from(fs.readFileSync(exePath))
const res = NtExecutableResource.from(exe)

const groups = Resource.IconGroupEntry.fromEntries(res.entries)
console.log('Icon groups found:')
groups.forEach((g) => console.log(' id=%s lang=%s icons=%d', g.id, g.lang, g.icons.length))
