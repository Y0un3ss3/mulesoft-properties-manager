import { findUnquotedHash } from './crypto'

/**
 * Parse a .properties or YAML file into flat key/value pairs.
 * Mirrors the original app.js parseProperties() exactly.
 */
export function parseProperties(content, format) {
  const pairs = []
  const lines = content.split(/\r?\n/)

  if (format !== 'yaml') {
    for (const line of lines) {
      if (!line.trim() || /^\s*[#!]/.test(line)) continue
      const m = line.match(/^\s*([^=:\s][^=:]*?)\s*[=:]\s*(.*)$/)
      if (!m) continue
      pairs.push({ key: m[1].trim(), value: m[2] })
    }
    return pairs
  }

  // --- YAML tokenizer ---
  const tokens = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim() || /^\s*#/.test(raw)) continue
    const indent = raw.match(/^(\s*)/)[1].length
    let body = raw.slice(indent)

    const h = findUnquotedHash(body)
    if (h >= 0) body = body.slice(0, h).replace(/\s+$/, '')

    if (body === '-' || body.startsWith('- ')) {
      const rest = body === '-' ? '' : body.slice(2)
      tokens.push({ indent, kind: 'seq', value: rest, lineNo: i + 1 })
    } else {
      const m = body.match(/^([^:#\s][^:]*?)\s*:\s*(.*)$/)
      if (!m) continue
      tokens.push({ indent, kind: 'map', key: m[1], value: m[2], lineNo: i + 1 })
    }
  }

  const unquote = (v) => {
    if (v.length >= 2) {
      const f = v[0], l = v[v.length - 1]
      if ((f === '"' && l === '"') || (f === "'" && l === "'")) return v.slice(1, -1)
    }
    return v
  }

  let idx = 0

  function parseBlock(minIndent, pathPrefix) {
    while (idx < tokens.length && tokens[idx].indent >= minIndent) {
      const tok = tokens[idx]
      if (tok.indent > minIndent) { idx++; continue }
      if (tok.kind === 'seq') return

      const keyPath = pathPrefix.concat(tok.key)
      const keyStr = keyPath.join('.')

      if (tok.value !== '') {
        pairs.push({ key: keyStr, value: unquote(tok.value) })
        idx++
        continue
      }

      idx++
      if (idx < tokens.length && tokens[idx].indent > tok.indent) {
        const childIndent = tokens[idx].indent
        if (tokens[idx].kind === 'seq') {
          parseSequence(keyStr, keyPath, childIndent)
        } else {
          parseBlock(childIndent, keyPath)
        }
      } else {
        pairs.push({ key: keyStr, value: '' })
      }
    }
  }

  function parseSequence(keyStr, pathPrefix, seqIndent) {
    const scalarItems = []
    let itemIdx = 0
    let anyMapping = false

    while (idx < tokens.length && tokens[idx].indent === seqIndent && tokens[idx].kind === 'seq') {
      const tok = tokens[idx]
      idx++

      const mapInline = tok.value.match(/^([^:#\s][^:]*?)\s*:\s*(.*)$/)
      const hasChildren = idx < tokens.length && tokens[idx].indent > seqIndent

      if (mapInline || hasChildren) {
        anyMapping = true
        const elemPath = pathPrefix.slice(0, -1).concat(`${pathPrefix[pathPrefix.length - 1]}[${itemIdx}]`)
        if (mapInline) {
          const [, k, v] = mapInline
          const subPath = elemPath.concat(k)
          if (v !== '') {
            pairs.push({ key: subPath.join('.'), value: unquote(v) })
          } else if (hasChildren) {
            parseBlock(tokens[idx].indent, subPath)
          } else {
            pairs.push({ key: subPath.join('.'), value: '' })
          }
        }
        if (idx < tokens.length && tokens[idx].indent > seqIndent) {
          parseBlock(tokens[idx].indent, elemPath)
        }
        itemIdx++
      } else {
        scalarItems.push(unquote(tok.value))
        itemIdx++
      }
    }

    if (!anyMapping) {
      pairs.push({ key: keyStr, value: `[${scalarItems.join(', ')}]`, isList: true, items: scalarItems })
    }
  }

  parseBlock(0, [])
  return pairs
}

export function detectFormat(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  return 'properties'
}

export function patternToRegex(pattern) {
  if (!pattern || !pattern.trim()) return null
  const p = pattern.trim()
  try {
    if (/\(\?<env>/.test(p)) return new RegExp('^' + p + '$', 'i')
    if (p.includes('{env}')) {
      const escaped = p
        .replace(/[.+^$|()[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\{env\}/, '(?<env>[A-Za-z0-9._-]+)')
      return new RegExp('^' + escaped + '$', 'i')
    }
    return new RegExp('^' + p + '$', 'i')
  } catch (_) {
    return null
  }
}

export function matchName(name, rx) {
  const m = name.match(rx)
  if (!m) return null
  return (m.groups && m.groups.env) || m[1] || null
}
