import { useState, useRef, useEffect } from 'react'
import { Icon } from './Icons'
import Status from './Status'
import { ALGO_META, validateKey, encrypt, decrypt, transformFile, formatBytes } from '../lib/crypto'
import { highlight } from '../lib/highlighter'

const ALGOS = ['AES', 'Blowfish', 'DES', 'DESede']
const MODES = ['CBC', 'CFB', 'ECB', 'OFB']

// ── Initial per-op state ───────────────────────────────────────────────────
const emptyOpState = () => ({
  input:       '',
  output:      '',
  status:      { msg: '', kind: null },
  fileInfo:    null,
  fileOutput:  '',
  fileStatus:  { msg: '', kind: null },
})

// ── File output preview dialog ─────────────────────────────────────────────
function FilePreviewDialog({ content, fileName, onClose }) {
  const dialogRef = useRef(null)
  const [copyLabel, setCopyLabel] = useState('Copy')

  const ext  = (fileName.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase()
  const lang = (ext === 'yaml' || ext === 'yml') ? 'yaml' : 'properties'
  const highlightedHtml = highlight(content, lang)

  useEffect(() => {
    const el = dialogRef.current
    if (el && typeof el.showModal === 'function') el.showModal()
    return () => { if (el && el.open) el.close() }
  }, [])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy'), 2000)
    } catch { /* ignore */ }
  }

  const lineCount = content.split('\n').length

  return (
    <dialog ref={dialogRef} className="value-dialog file-preview-dialog" aria-labelledby="fpTitle"
      onClick={(e) => { if (e.target === dialogRef.current) onClose() }}>
      <div className="value-dialog-inner">
        <header className="value-dialog-header">
          <div>
            <div className="value-dialog-eyebrow">Output preview · {lang.toUpperCase()}</div>
            <h3 id="fpTitle" className="value-dialog-title">{fileName}</h3>
            <div className="value-dialog-meta">
              <span className="pill">{lineCount} line{lineCount !== 1 ? 's' : ''}</span>
              <span className="pill">{formatBytes(new TextEncoder().encode(content).length)}</span>
            </div>
          </div>
          <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>
            <Icon id="i-x-mark" />
          </button>
        </header>
        <div className="file-preview-body">
          <pre style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        </div>
        <footer className="value-dialog-footer">
          <div className="status" />
          <div className="value-dialog-actions">
            <button type="button" className="btn btn-primary" onClick={handleCopy}>
              <Icon id="i-clipboard" /><span>{copyLabel}</span>
            </button>
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </footer>
      </div>
    </dialog>
  )
}

// ── Main CryptoView ────────────────────────────────────────────────────────
export default function CryptoView() {
  const [op, setOp] = useState('encrypt')   // 'encrypt' | 'decrypt'
  const [method, setMethod] = useState('string')
  const [algo, setAlgo] = useState('AES')
  const [mode, setMode] = useState('CBC')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [randomIv, setRandomIv] = useState(false)
  const [dragover, setDragover] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy')
  const [fileCopyLabel, setFileCopyLabel] = useState('Copy')
  const [showPreview, setShowPreview] = useState(false)

  // Per-op state: each tab has its own input/output/file/status
  const [opState, setOpState] = useState({
    encrypt: emptyOpState(),
    decrypt: emptyOpState(),
  })

  // Convenience accessors for the current op
  const s = opState[op]
  const setS = (patch) => setOpState((prev) => ({
    ...prev,
    [op]: { ...prev[op], ...(typeof patch === 'function' ? patch(prev[op]) : patch) },
  }))

  const meta = ALGO_META[algo]
  const keyBytes = new TextEncoder().encode(key).length
  const algoHint = `Key size: ${meta.label}`
  const keyHint = keyBytes ? `Current key length: ${keyBytes} byte${keyBytes === 1 ? '' : 's'}` : ''
  const ivDisabled = mode === 'ECB'
  const ivHint = mode === 'ECB'
    ? 'ECB does not use an IV.'
    : randomIv
      ? 'A random IV is generated and prepended to the ciphertext (first block) in Base64.'
      : 'IV defaults to the key bytes (truncated or zero-padded to the block size).'

  // ── String mode ────────────────────────────────────────────────────────────

  function handleSubmit(e) {
    e.preventDefault()
    setS({ status: { msg: '', kind: null } })
    if (!key) return setS({ status: { msg: 'Please provide a key.', kind: 'error' } })
    if (!s.input) return setS({ status: { msg: 'Please provide a value.', kind: 'error' } })
    const keyErr = validateKey(algo, key)
    if (keyErr) return setS({ status: { msg: keyErr, kind: 'error' } })
    try {
      const result = op === 'encrypt'
        ? encrypt(algo, mode, key, s.input, { randomIv })
        : decrypt(algo, mode, key, s.input, { randomIv })
      setS({ output: result, status: { msg: op === 'encrypt' ? 'Encrypted.' : 'Decrypted.', kind: 'ok' } })
    } catch (err) {
      setS({ output: '', status: { msg: err.message || 'Operation failed.', kind: 'error' } })
    }
  }

  function handleClear() {
    setS({ input: '', output: '', status: { msg: '', kind: null } })
  }

  async function handleCopy() {
    if (!s.output) return
    try {
      await navigator.clipboard.writeText(s.output)
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy'), 2000)
    } catch {
      setS({ status: { msg: 'Could not copy to clipboard.', kind: 'error' } })
    }
  }

  // ── File mode ──────────────────────────────────────────────────────────────

  function loadFile(file) {
    const reader = new FileReader()
    reader.onload = () => {
      setS({ fileInfo: { name: file.name, size: file.size, content: reader.result }, fileOutput: '', fileStatus: { msg: `Loaded ${file.name}.`, kind: 'ok' } })
    }
    reader.onerror = () => setS({ fileStatus: { msg: 'Could not read file.', kind: 'error' } })
    reader.readAsText(file)
  }

  function handleDropzoneDrop(e) {
    e.preventDefault(); setDragover(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) loadFile(f)
  }

  async function handlePickFile() {
    if (window.electronAPI) {
      const files = await window.electronAPI.pickFiles()
      if (files?.length) {
        const f = files[0]
        setS({ fileInfo: { name: f.name, size: f.content.length, content: f.content }, fileOutput: '', fileStatus: { msg: `Loaded ${f.name}.`, kind: 'ok' } })
      }
    } else {
      document.getElementById('fileInput').click()
    }
  }

  function handleFileInputChange(e) {
    const f = e.target.files?.[0]
    if (f) loadFile(f)
  }

  function handleClearFile() {
    setS({ fileInfo: null, fileOutput: '', fileStatus: { msg: '', kind: null } })
  }

  function handleSubmitFile(e) {
    e.preventDefault()
    setS({ fileStatus: { msg: '', kind: null } })
    if (!key) return setS({ fileStatus: { msg: 'Please provide a key.', kind: 'error' } })
    if (!s.fileInfo) return setS({ fileStatus: { msg: 'Please select a file.', kind: 'error' } })
    const keyErr = validateKey(algo, key)
    if (keyErr) return setS({ fileStatus: { msg: keyErr, kind: 'error' } })
    const format = s.fileInfo.name.toLowerCase().match(/\.ya?ml$/) ? 'yaml' : 'properties'
    try {
      const { output: out, processed, skipped } = transformFile(s.fileInfo.content, format, algo, mode, key, op, { randomIv })
      const action = op === 'encrypt' ? 'Encrypted' : 'Decrypted'
      const skippedMsg = skipped ? `, ${skipped} skipped` : ''
      setS({ fileOutput: out, fileStatus: { msg: `${action} ${processed} value${processed === 1 ? '' : 's'}${skippedMsg}.`, kind: 'ok' } })
    } catch (err) {
      setS({ fileOutput: '', fileStatus: { msg: err.message || 'Operation failed.', kind: 'error' } })
    }
  }

  async function handleDownload() {
    if (!s.fileOutput || !s.fileInfo) return
    const base = s.fileInfo.name.replace(/(\.[^.]+)?$/, '')
    const ext  = (s.fileInfo.name.match(/\.[^.]+$/) || [''])[0]
    const defaultName = `${base}${op === 'encrypt' ? '.encrypted' : '.decrypted'}${ext}`
    if (window.electronAPI) {
      await window.electronAPI.saveFile({ defaultName, content: s.fileOutput })
    } else {
      const blob = new Blob([s.fileOutput], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = defaultName
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    }
  }

  async function handleFileCopy() {
    if (!s.fileOutput) return
    try {
      await navigator.clipboard.writeText(s.fileOutput)
      setFileCopyLabel('Copied!')
      setTimeout(() => setFileCopyLabel('Copy'), 2000)
    } catch {
      setS({ fileStatus: { msg: 'Could not copy to clipboard.', kind: 'error' } })
    }
  }

  const previewFileName = (() => {
    if (!s.fileInfo) return 'output'
    const base = s.fileInfo.name.replace(/(\.[^.]+)?$/, '')
    const ext  = (s.fileInfo.name.match(/\.[^.]+$/) || [''])[0]
    return `${base}${op === 'encrypt' ? '.encrypted' : '.decrypted'}${ext}`
  })()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="card card-fill" id="cryptoView">
      {/* Encrypt / Decrypt tabs */}
      <div className="tabs" role="tablist">
        {['encrypt', 'decrypt'].map((o) => (
          <button key={o} className={`tab${op === o ? ' active' : ''}`} role="tab" aria-selected={op === o}
            onClick={() => { setOp(o); setCopyLabel('Copy'); setFileCopyLabel('Copy') }}>
            <Icon id={o === 'encrypt' ? 'i-lock-closed' : 'i-lock-open'} />
            <span>{o === 'encrypt' ? 'Encrypt' : 'Decrypt'}</span>
          </button>
        ))}
      </div>

      <form onSubmit={method === 'file' ? handleSubmitFile : handleSubmit} autoComplete="off">
        {/* Method segmented control */}
        <div className="field">
          <label>Method</label>
          <div className="segmented" role="tablist">
            {[['string', 'i-code-bracket', 'String'], ['file', 'i-document-text', 'File']].map(([m, icon, label]) => (
              <button key={m} type="button" className={`seg${method === m ? ' active' : ''}`}
                role="tab" aria-selected={method === m} onClick={() => setMethod(m)}>
                <Icon id={icon} /><span>{label}</span>
              </button>
            ))}
          </div>
          <small className="hint">
            {method === 'string' ? 'Encrypt or decrypt a single value.' : 'Process a .properties or .yaml file, value by value.'}
          </small>
        </div>

        {/* Algorithm + Mode */}
        <div className="grid">
          <div className="field">
            <label htmlFor="algorithm">Algorithm</label>
            <select id="algorithm" value={algo} onChange={(e) => setAlgo(e.target.value)}>
              {ALGOS.map((a) => <option key={a} value={a}>{a === 'DESede' ? 'Triple DES (DESede)' : a}</option>)}
            </select>
            <small className="hint">{algoHint}</small>
          </div>
          <div className="field">
            <label htmlFor="mode">Mode</label>
            <select id="mode" value={mode} onChange={(e) => { setMode(e.target.value); if (e.target.value === 'ECB') setRandomIv(false) }}>
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <small className="hint">PKCS5 / PKCS7 padding</small>
          </div>
        </div>

        {/* Key — shared between tabs (same key is typically used for both ops) */}
        <div className="field">
          <label htmlFor="key">Key</label>
          <div className="input-group">
            <span className="input-leading"><Icon id="i-key" /></span>
            <input id="key" type={showKey ? 'text' : 'password'} placeholder="Enter secret key"
              spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="button" className="input-trailing" aria-label="Show or hide key"
              onClick={() => setShowKey((v) => !v)}>
              <Icon id={showKey ? 'i-eye-slash' : 'i-eye'} />
            </button>
          </div>
          {keyHint && <small className="hint">{keyHint}</small>}
        </div>

        {/* Random IV */}
        <div className="field checkbox-field">
          <label className="checkbox">
            <input id="randomIv" type="checkbox" checked={randomIv} disabled={ivDisabled}
              onChange={(e) => setRandomIv(e.target.checked)} />
            <span>Use random IV</span>
          </label>
          <small className="hint">{ivHint}</small>
        </div>

        {/* String panel */}
        {method === 'string' && (
          <div className="method-panel method-panel-string">
            <div className="field field-grow">
              <label htmlFor="input">{op === 'encrypt' ? 'Plain value' : 'Encrypted value (Base64)'}</label>
              <textarea id="input" className="textarea-grow"
                placeholder={op === 'encrypt' ? 'Type the value to encrypt…' : 'Paste the Base64 ciphertext…'}
                spellCheck={false} value={s.input} onChange={(e) => setS({ input: e.target.value })} />
            </div>
            <div className="actions">
              <button type="submit" className="btn btn-primary" disabled={!key || !s.input}>
                <Icon id={op === 'encrypt' ? 'i-lock-closed' : 'i-lock-open'} />
                <span>{op === 'encrypt' ? 'Encrypt' : 'Decrypt'}</span>
              </button>
              <button type="button" className="btn" onClick={handleClear}>
                <Icon id="i-x-mark" /><span>Clear</span>
              </button>
            </div>
            <div className="field field-grow">
              <div className="label-row">
                <label htmlFor="output">{op === 'encrypt' ? 'Encrypted value (Base64)' : 'Plain value'}</label>
                <button type="button" className="btn btn-sm" disabled={!s.output} onClick={handleCopy}>
                  <Icon id="i-clipboard" /><span>{copyLabel}</span>
                </button>
              </div>
              <textarea id="output" className="textarea-grow" readOnly placeholder="Result appears here…" value={s.output} />
              <Status {...s.status} />
            </div>
          </div>
        )}

        {/* File panel */}
        {method === 'file' && (
          <div className="method-panel method-panel-file">
            <div className="field">
              <label>Input file</label>
              <div
                className={`dropzone${s.fileInfo ? ' has-file' : ''}${dragover ? ' dragover' : ''}`}
                tabIndex={0} role="button" aria-label="Drop a file or click to browse"
                onClick={handlePickFile}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePickFile() } }}
                onDragEnter={(e) => { e.preventDefault(); setDragover(true) }}
                onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
                onDragLeave={(e) => { e.preventDefault(); setDragover(false) }}
                onDrop={handleDropzoneDrop}
              >
                <Icon id="i-arrow-up-tray" size="lg" />
                <div>
                  <strong>{s.fileInfo ? s.fileInfo.name : 'Drop a .properties or .yaml file here'}</strong>
                  <div className="hint">or click to browse. Values are processed line by line.</div>
                </div>
              </div>
              <input id="fileInput" type="file" accept=".properties,.yaml,.yml,.txt" hidden onChange={handleFileInputChange} />
              {s.fileInfo && <small className="hint">{s.fileInfo.name} · {formatBytes(s.fileInfo.size)}</small>}
            </div>

            <div className="actions">
              <button type="submit" className="btn btn-primary" disabled={!key || !s.fileInfo}>
                <Icon id={op === 'encrypt' ? 'i-lock-closed' : 'i-lock-open'} />
                <span>{op === 'encrypt' ? 'Encrypt file' : 'Decrypt file'}</span>
              </button>
              <button type="button" className="btn" onClick={handleClearFile}>
                <Icon id="i-x-mark" /><span>Clear</span>
              </button>
            </div>

            <div className="field field-grow">
              <div className="label-row">
                <label htmlFor="fileOutput">Output</label>
                <div className="file-output-actions">
                  <button type="button" className="btn btn-sm" disabled={!s.fileOutput} onClick={handleDownload}>
                    <Icon id="i-arrow-down-tray" /><span>Download</span>
                  </button>
                  <button type="button" className="btn btn-sm" disabled={!s.fileOutput} onClick={handleFileCopy}>
                    <Icon id="i-clipboard" /><span>{fileCopyLabel}</span>
                  </button>
                  <button type="button" className="btn btn-sm" disabled={!s.fileOutput} onClick={() => setShowPreview(true)}>
                    <Icon id="i-arrows-expand" /><span>Preview</span>
                  </button>
                </div>
              </div>
              <textarea id="fileOutput" className="textarea-grow" readOnly
                placeholder="Processed file content appears here…" value={s.fileOutput} />
              <Status {...s.fileStatus} />
            </div>
          </div>
        )}
      </form>

      {showPreview && s.fileOutput && (
        <FilePreviewDialog
          content={s.fileOutput}
          fileName={previewFileName}
          onClose={() => setShowPreview(false)}
        />
      )}
    </section>
  )
}
