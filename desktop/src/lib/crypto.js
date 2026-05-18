import CryptoJS from 'crypto-js'

export const ALGO_META = {
  AES:      { blockSize: 16, validKeySizes: [16, 24, 32], label: '16, 24, or 32 bytes' },
  Blowfish: { blockSize: 8,  validKeySizes: null,          label: '4 to 56 bytes' },
  DES:      { blockSize: 8,  validKeySizes: [8],           label: '8 bytes' },
  DESede:   { blockSize: 8,  validKeySizes: [16, 24],      label: '16 or 24 bytes' },
}

const MODE_MAP = {
  CBC: CryptoJS.mode.CBC,
  CFB: CryptoJS.mode.CFB,
  ECB: CryptoJS.mode.ECB,
  OFB: CryptoJS.mode.OFB,
}

export function validateKey(algo, key) {
  const meta = ALGO_META[algo]
  const keyBytes = new TextEncoder().encode(key).length
  if (meta.validKeySizes && !meta.validKeySizes.includes(keyBytes)) {
    return `Invalid key size for ${algo}. Expected ${meta.validKeySizes.join(' / ')} bytes, got ${keyBytes}.`
  }
  if (algo === 'Blowfish' && (keyBytes < 4 || keyBytes > 56)) {
    return `Blowfish key must be 4 to 56 bytes (got ${keyBytes}).`
  }
  return null
}

function keyWordArray(algo, key) {
  const raw = CryptoJS.enc.Utf8.parse(key)
  if (algo === 'DESede' && raw.sigBytes === 16) {
    const words = raw.words.slice()
    words.push(raw.words[0], raw.words[1])
    return CryptoJS.lib.WordArray.create(words, 24)
  }
  return raw
}

function zeroIv(blockSize) {
  return CryptoJS.lib.WordArray.create(new Array(blockSize / 4).fill(0), blockSize)
}

function keyDerivedIv(key, blockSize) {
  const full = CryptoJS.enc.Utf8.parse(key)
  const words = new Array(blockSize / 4).fill(0)
  const bytesToCopy = Math.min(full.sigBytes, blockSize)
  for (let i = 0; i < bytesToCopy; i++) {
    const b = (full.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
    words[i >>> 2] |= b << (24 - (i % 4) * 8)
  }
  return CryptoJS.lib.WordArray.create(words, blockSize)
}

function randomWordIv(blockSize) {
  return CryptoJS.lib.WordArray.random(blockSize)
}

function cipherFor(algo) {
  switch (algo) {
    case 'AES':      return CryptoJS.AES
    case 'Blowfish': return CryptoJS.Blowfish
    case 'DES':      return CryptoJS.DES
    case 'DESede':   return CryptoJS.TripleDES
    default: throw new Error('Unsupported algorithm: ' + algo)
  }
}

export function encrypt(algo, mode, key, value, options = {}) {
  const cipher = cipherFor(algo)
  const meta = ALGO_META[algo]
  const useRandom = !!options.randomIv && mode !== 'ECB'
  const iv = mode === 'ECB'
    ? zeroIv(meta.blockSize)
    : useRandom ? randomWordIv(meta.blockSize) : keyDerivedIv(key, meta.blockSize)

  const cfg = { mode: MODE_MAP[mode], padding: CryptoJS.pad.Pkcs7, iv }
  const out = cipher.encrypt(CryptoJS.enc.Utf8.parse(value), keyWordArray(algo, key), cfg)

  if (useRandom) {
    const combined = iv.clone()
    combined.concat(out.ciphertext)
    return combined.toString(CryptoJS.enc.Base64)
  }
  return out.ciphertext.toString(CryptoJS.enc.Base64)
}

export function decrypt(algo, mode, key, value, options = {}) {
  const cipher = cipherFor(algo)
  const meta = ALGO_META[algo]
  const useRandom = !!options.randomIv && mode !== 'ECB'

  let data = CryptoJS.enc.Base64.parse(value.trim())
  let iv

  if (mode === 'ECB') {
    iv = zeroIv(meta.blockSize)
  } else if (useRandom) {
    if (data.sigBytes < meta.blockSize) throw new Error('Ciphertext is too short to contain an IV.')
    iv = CryptoJS.lib.WordArray.create(data.words.slice(0, meta.blockSize / 4), meta.blockSize)
    data = CryptoJS.lib.WordArray.create(data.words.slice(meta.blockSize / 4), data.sigBytes - meta.blockSize)
  } else {
    iv = keyDerivedIv(key, meta.blockSize)
  }

  const cfg = { mode: MODE_MAP[mode], padding: CryptoJS.pad.Pkcs7, iv }
  const params = CryptoJS.lib.CipherParams.create({ ciphertext: data })
  const decrypted = cipher.decrypt(params, keyWordArray(algo, key), cfg)

  let plain
  try {
    plain = decrypted.toString(CryptoJS.enc.Utf8)
  } catch {
    throw new Error('Decryption failed. Check the key, algorithm, mode, and IV option.')
  }
  if (!plain && value) throw new Error('Decryption failed. Check the key, algorithm, mode, and IV option.')
  return plain
}

export function unwrapSecure(value) {
  const m = value.match(/^!\[(.*)\]$/)
  if (m) return { wrapped: true, value: m[1] }
  return { wrapped: false, value }
}

export function findUnquotedHash(s) {
  let inSingle = false, inDouble = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '"' && !inSingle) inDouble = !inDouble
    else if (c === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(s[i - 1])) return i
    }
  }
  return -1
}

export function transformFile(content, format, algo, mode, key, op, options = {}) {
  const lines = content.split(/\r?\n/)
  const out = new Array(lines.length)
  let processed = 0
  let skipped = 0

  const separator = format === 'yaml'
    ? /^(\s*)([^:#\s][^:]*?)\s*:\s*(.*)$/
    : /^(\s*)([^=:#\s][^=:]*?)\s*([=:])\s*(.*)$/
  const seqItemRe = /^(\s*-\s?)(.+)$/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*[#!]/.test(line)) { out[i] = line; continue }

    const m = line.match(separator)

    // YAML sequence items: "  - value"
    if (!m && format === 'yaml') {
      const seqMatch = line.match(seqItemRe)
      if (seqMatch) {
        const prefix = seqMatch[1]
        let value = seqMatch[2]

        // Strip trailing inline comment
        let trailing = ''
        const hashIdx = findUnquotedHash(value)
        if (hashIdx >= 0) {
          trailing = value.slice(hashIdx)
          value = value.slice(0, hashIdx).replace(/\s+$/, '')
        }

        // Unwrap quotes
        let quote = ''
        if (value.length >= 2) {
          const first = value[0], last = value[value.length - 1]
          if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            quote = first
            value = value.slice(1, -1)
          }
        }

        if (value === '') { out[i] = line; skipped++; continue }

        try {
          let newValue
          if (op === 'encrypt') {
            const encrypted = encrypt(algo, mode, key, unwrapSecure(value).value, options)
            newValue = `![${encrypted}]`
          } else {
            const inner = unwrapSecure(value)
            if (!inner.wrapped) { out[i] = line; skipped++; continue }
            newValue = decrypt(algo, mode, key, inner.value, options)
          }
          const wrapped = quote ? `${quote}${newValue}${quote}` : newValue
          out[i] = `${prefix}${wrapped}${trailing ? ' ' + trailing : ''}`
          processed++
        } catch (err) {
          throw new Error(`Line ${i + 1}: ${err.message}`)
        }
        continue
      }
    }

    if (!m) { out[i] = line; continue }

    let prefix, rawValue
    if (format === 'yaml') {
      const [, indent, k, v] = m
      prefix = `${indent}${k}: `
      rawValue = v
    } else {
      const [, indent, k, sep, v] = m
      prefix = `${indent}${k}${sep}`
      rawValue = v
    }

    let value = rawValue
    let trailing = ''
    if (format === 'yaml') {
      const hashIdx = findUnquotedHash(value)
      if (hashIdx >= 0) {
        trailing = value.slice(hashIdx)
        value = value.slice(0, hashIdx).replace(/\s+$/, '')
      }
    }

    let quote = ''
    if (format === 'yaml' && value.length >= 2) {
      const first = value[0], last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        quote = first
        value = value.slice(1, -1)
      }
    }

    if (value === '') { out[i] = line; skipped++; continue }

    try {
      let newValue
      if (op === 'encrypt') {
        const encrypted = encrypt(algo, mode, key, unwrapSecure(value).value, options)
        newValue = `![${encrypted}]`
      } else {
        const inner = unwrapSecure(value)
        if (!inner.wrapped) { out[i] = line; skipped++; continue }
        newValue = decrypt(algo, mode, key, inner.value, options)
      }
      const wrapped = quote ? `${quote}${newValue}${quote}` : newValue
      out[i] = `${prefix}${wrapped}${trailing ? ' ' + trailing : ''}`
      processed++
    } catch (err) {
      throw new Error(`Line ${i + 1}: ${err.message}`)
    }
  }

  return { output: out.join('\n'), processed, skipped }
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
