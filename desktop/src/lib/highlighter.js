/**
 * Custom syntax highlighter for .yaml and .properties files.
 * Returns an array of line token arrays — each token is { type, text }.
 *
 * Token types:
 *   comment      — # or ## lines
 *   indent       — leading whitespace (preserved as-is)
 *   key          — the property key
 *   separator    — ": " or "=" or ":"
 *   value        — plain value
 *   encrypted    — ![...] wrapped ciphertext
 *   bracket      — the ![ and ] delimiters around ciphertext
 *   string-quote — surrounding quotes on a YAML string value
 *   number       — numeric value
 *   boolean      — true / false / yes / no / null
 *   punctuation  — structural characters (- for sequences)
 */

function escHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Tokenise a single value string into spans (handles encrypted, quoted, plain)
function tokeniseValue(raw) {
  if (!raw) return ''

  // Quoted string — may contain ![...] inside
  const quoteMatch = raw.match(/^(['"])(.*)\1$/)
  if (quoteMatch) {
    const [, q, inner] = quoteMatch
    return (
      `<span class="hl-string-quote">${escHtml(q)}</span>` +
      tokeniseValue(inner) +
      `<span class="hl-string-quote">${escHtml(q)}</span>`
    )
  }

  // Encrypted value ![...]
  const encMatch = raw.match(/^(!\[)(.*?)(\])(.*)$/)
  if (encMatch) {
    const [, open, cipher, close, rest] = encMatch
    return (
      `<span class="hl-bracket">${escHtml(open)}</span>` +
      `<span class="hl-encrypted">${escHtml(cipher)}</span>` +
      `<span class="hl-bracket">${escHtml(close)}</span>` +
      (rest ? `<span class="hl-value">${escHtml(rest)}</span>` : '')
    )
  }

  // Boolean / null
  if (/^(true|false|yes|no|null|~)$/i.test(raw.trim())) {
    return `<span class="hl-boolean">${escHtml(raw)}</span>`
  }

  // Number
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw.trim())) {
    return `<span class="hl-number">${escHtml(raw)}</span>`
  }

  return `<span class="hl-value">${escHtml(raw)}</span>`
}

// Highlight a single YAML line
function highlightYamlLine(line) {
  // Blank
  if (!line.trim()) return ''

  // Comment
  if (/^\s*#/.test(line)) {
    return `<span class="hl-comment">${escHtml(line)}</span>`
  }

  // Sequence item: "  - value" or "  -"
  const seqMatch = line.match(/^(\s*)(- ?)(.*)$/)
  if (seqMatch && !seqMatch[3].includes(':')) {
    const [, indent, dash, rest] = seqMatch
    return (
      escHtml(indent) +
      `<span class="hl-punctuation">${escHtml(dash)}</span>` +
      tokeniseValue(rest.trim())
    )
  }

  // Key: value
  const kvMatch = line.match(/^(\s*)([^:#\s][^:]*?)\s*:\s*(.*)$/)
  if (kvMatch) {
    const [, indent, key, value] = kvMatch

    // Strip trailing inline comment from value
    let val = value
    let trailingComment = ''
    // Simple heuristic: unquoted # preceded by space
    const hashIdx = val.search(/\s#/)
    if (hashIdx >= 0 && !val.startsWith('"') && !val.startsWith("'")) {
      trailingComment = val.slice(hashIdx)
      val = val.slice(0, hashIdx)
    }

    return (
      escHtml(indent) +
      `<span class="hl-key">${escHtml(key)}</span>` +
      `<span class="hl-separator">: </span>` +
      tokeniseValue(val.trim()) +
      (trailingComment ? `<span class="hl-comment">${escHtml(trailingComment)}</span>` : '')
    )
  }

  return escHtml(line)
}

// Highlight a single .properties line
function highlightPropertiesLine(line) {
  if (!line.trim()) return ''

  // Comment (# or !)
  if (/^\s*[#!]/.test(line)) {
    return `<span class="hl-comment">${escHtml(line)}</span>`
  }

  // key=value or key: value or key value
  const kvMatch = line.match(/^(\s*)([^=:\s][^=:]*?)\s*([=:])\s*(.*)$/)
  if (kvMatch) {
    const [, indent, key, sep, value] = kvMatch
    return (
      escHtml(indent) +
      `<span class="hl-key">${escHtml(key)}</span>` +
      `<span class="hl-separator">${escHtml(sep)}</span>` +
      tokeniseValue(value)
    )
  }

  return escHtml(line)
}

/**
 * Returns an HTML string with syntax-highlighted content.
 * @param {string} content  Raw file text
 * @param {'yaml'|'properties'} lang
 */
export function highlight(content, lang) {
  const lines = content.split('\n')
  const fn = lang === 'yaml' ? highlightYamlLine : highlightPropertiesLine
  return lines.map(fn).join('\n')
}
