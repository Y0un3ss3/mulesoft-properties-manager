import { useState, useEffect, useRef, useCallback } from 'react'
import { Icon } from './Icons'
import Status from './Status'
import ValueDialog from './ValueDialog'
import { validateKey, decrypt, unwrapSecure } from '../lib/crypto'
import { parseProperties, detectFormat, patternToRegex, matchName } from '../lib/parser'

const ALGOS = ['AES', 'Blowfish', 'DES', 'DESede']
const MODES = ['CBC', 'CFB', 'ECB', 'OFB']

export default function InspectView({ isWide, onWideChange, isActive }) {
  const [files, setFiles] = useState([])           // { name, content }
  const [envs, setEnvs] = useState(new Map())      // env -> { plainFiles, secureFiles, config }
  const [envOrder, setEnvOrder] = useState([])
  const [envPattern, setEnvPattern] = useState('{env}-configuration.yaml')
  const [securePattern, setSecurePattern] = useState('{env}-secure-configuration.yaml')
  const [results, setResults] = useState(null)     // { envs, keys, rows }
  const [revealed, setRevealed] = useState(new Set())
  const [inspectStatus, setInspectStatus] = useState({ msg: '', kind: null })
  const [filter, setFilter] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [diffOnly, setDiffOnly] = useState(false)
  const [revealAll, setRevealAll] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [dragover, setDragover] = useState(false)
  const [dialog, setDialog] = useState(null)       // { key, env, cell, row, allEnvs }
  const draggedEnv = useRef(null)

  // ── File loading ────────────────────────────────────────────────────────────

  function addRawFiles(rawFiles) {
    const accepted = rawFiles.filter((f) => /\.(properties|ya?ml|txt)$/i.test(f.name))
    if (!accepted.length) {
      setInspectStatus({ msg: 'No supported files found. Use .properties, .yaml, or .yml.', kind: 'error' })
      return
    }
    setFiles((prev) => {
      const next = [...prev]
      for (const f of accepted) {
        if (!next.some((x) => x.name === f.name)) next.push({ name: f.name, content: f.content })
      }
      return next
    })
  }

  async function handlePickFiles() {
    if (window.electronAPI) {
      const picked = await window.electronAPI.pickFiles()
      if (picked?.length) addRawFiles(picked)
    } else {
      document.getElementById('inspectFileInput').click()
    }
  }

  async function handlePickFolder() {
    if (window.electronAPI) {
      const picked = await window.electronAPI.pickFolder()
      if (picked?.length) addRawFiles(picked)
    } else {
      document.getElementById('inspectFolderInput').click()
    }
  }

  function handleFileInputChange(e) {
    const list = Array.from(e.target.files || [])
    const readers = list.map((f) => new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res({ name: f.name, content: String(r.result || '') })
      r.onerror = () => res(null)
      r.readAsText(f)
    }))
    Promise.all(readers).then((entries) => addRawFiles(entries.filter(Boolean)))
  }

  function handleDropzoneDrop(e) {
    e.preventDefault()
    setDragover(false)
    const dtFiles = Array.from(e.dataTransfer?.files || [])
    const readers = dtFiles.map((f) => new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res({ name: f.name, content: String(r.result || '') })
      r.onerror = () => res(null)
      r.readAsText(f)
    }))
    Promise.all(readers).then((entries) => addRawFiles(entries.filter(Boolean)))
  }

  // ── Reclassify whenever files or patterns change ────────────────────────────

  useEffect(() => {
    const envRx = patternToRegex(envPattern)
    const secRx = patternToRegex(securePattern)
    const newEnvs = new Map()

    for (const f of files) {
      const secMatch = secRx && matchName(f.name, secRx)
      const envMatch = envRx && matchName(f.name, envRx)
      const env = secMatch || envMatch || null
      const secure = !!secMatch

      if (env) {
        if (!newEnvs.has(env)) {
          newEnvs.set(env, {
            plainFiles: [],
            secureFiles: [],
            config: { key: '', algo: 'AES', mode: 'CBC', randomIv: false, show: false },
          })
        }
        const bucket = newEnvs.get(env)
        ;(secure ? bucket.secureFiles : bucket.plainFiles).push({ ...f, secure })
      }
    }

    // Preserve existing config
    setEnvs((prev) => {
      for (const [name, bucket] of newEnvs) {
        const p = prev.get(name)
        if (p) bucket.config = { ...p.config }
      }
      return newEnvs
    })

    setEnvOrder((prev) => {
      const filtered = prev.filter((e) => newEnvs.has(e))
      for (const name of newEnvs.keys()) {
        if (!filtered.includes(name)) filtered.push(name)
      }
      return filtered
    })
  }, [files, envPattern, securePattern])

  // ── Analyze ─────────────────────────────────────────────────────────────────

  function analyzeEnvs() {
    setInspectStatus({ msg: '', kind: null })
    if (!envs.size) return

    for (const [env, bucket] of envs) {
      if (!bucket.secureFiles.length || !bucket.config.key) continue
      const err = validateKey(bucket.config.algo, bucket.config.key)
      if (err) return setInspectStatus({ msg: `${env}: ${err}`, kind: 'error' })
    }

    const envNames = envOrder.filter((e) => envs.has(e))
    const perEnv = new Map()

    for (const env of envNames) {
      const bucket = envs.get(env)
      const merged = new Map()
      const hasKey = !!bucket.config.key

      for (const file of [...bucket.plainFiles, ...bucket.secureFiles]) {
        const format = detectFormat(file.name)
        const pairs = parseProperties(file.content, format)
        for (const pair of pairs) {
          const { key, value, isList, items } = pair
          let v = value, secure = false, encrypted = false, error = null

          if (isList && items) {
            const out = []
            for (const item of items) {
              const inner = unwrapSecure(item)
              if (!inner.wrapped) { out.push(item); continue }
              secure = true
              if (!hasKey) { out.push(inner.value); encrypted = true }
              else {
                try {
                  const dec = decrypt(bucket.config.algo, bucket.config.mode, bucket.config.key, inner.value, { randomIv: bucket.config.randomIv })
                  if (!dec) { error = 'Decryption produced empty result.'; out.push(inner.value); encrypted = true }
                  else out.push(dec)
                } catch (e) { error = e.message || 'Decryption failed.'; out.push(inner.value); encrypted = true }
              }
            }
            v = `[${out.join(', ')}]`
            if (file.secure && !secure) secure = true
          } else {
            const inner = unwrapSecure(v)
            if (inner.wrapped) {
              secure = true
              if (!hasKey) { v = inner.value; encrypted = true }
              else {
                try {
                  v = decrypt(bucket.config.algo, bucket.config.mode, bucket.config.key, inner.value, { randomIv: bucket.config.randomIv })
                  if (!v) { error = 'Decryption produced empty result.'; v = inner.value; encrypted = true }
                } catch (e) { error = e.message || 'Decryption failed.'; v = inner.value; encrypted = true }
              }
            } else if (file.secure) { secure = true }
          }
          merged.set(key, { value: v, secure, encrypted, error, sourceFile: file.name })
        }
      }
      perEnv.set(env, merged)
    }

    const keySet = new Set()
    for (const m of perEnv.values()) for (const k of m.keys()) keySet.add(k)
    const keys = Array.from(keySet).sort()

    const rows = keys.map((key) => {
      const cells = envNames.map((env) => {
        const m = perEnv.get(env).get(key)
        return m ? { ...m } : { missing: true }
      })
      const present = cells.filter((c) => !c.missing)
      const comparable = present.filter((c) => !c.encrypted && !c.error)
      const values = comparable.map((c) => c.value)
      return {
        key, cells,
        missing: cells.some((c) => c.missing),
        different: comparable.length > 1 && !values.every((v) => v === values[0]),
        anySecure: cells.some((c) => !c.missing && c.secure),
        anyEncrypted: cells.some((c) => !c.missing && c.encrypted),
      }
    })

    const newResults = { envs: envNames, keys, rows }
    setResults(newResults)
    setRevealed(new Set())
    onWideChange(true)

    const errs = rows.reduce((n, r) => n + r.cells.filter((c) => c.error).length, 0)
    const enc = rows.reduce((n, r) => n + r.cells.filter((c) => c.encrypted && !c.error).length, 0)
    const bits = [`Analyzed ${keys.length} key(s) across ${envNames.length} env(s).`]
    if (enc) bits.push(`${enc} value(s) left encrypted (no key provided).`)
    if (errs) bits.push(`${errs} decryption error(s).`)
    setInspectStatus({ msg: bits.join(' '), kind: errs ? 'error' : enc ? 'info' : 'ok' })
  }

  function clearInspector() {
    setFiles([])
    setEnvs(new Map())
    setEnvOrder([])
    setResults(null)
    setRevealed(new Set())
    setInspectStatus({ msg: '', kind: null })
    setFullscreen(false)
    onWideChange(false)
  }

  // ── Env config helpers ──────────────────────────────────────────────────────

  function updateEnvConfig(envName, patch) {
    setEnvs((prev) => {
      const next = new Map(prev)
      const bucket = next.get(envName)
      if (bucket) next.set(envName, { ...bucket, config: { ...bucket.config, ...patch } })
      return next
    })
  }

  function removeEnv(envName) {
    setFiles((prev) => prev.filter((f) => {
      const secRx = patternToRegex(securePattern)
      const envRx = patternToRegex(envPattern)
      const sec = secRx && matchName(f.name, secRx)
      const env = envRx && matchName(f.name, envRx)
      return (sec || env) !== envName
    }))
  }

  // ── Drag-and-drop env reorder ───────────────────────────────────────────────

  function handleEnvDragStart(e, envName) {
    draggedEnv.current = envName
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', envName)
  }

  function handleEnvDragOver(e, envName) {
    if (!draggedEnv.current || draggedEnv.current === envName) return
    e.preventDefault()
    setEnvOrder((prev) => {
      const next = [...prev]
      const from = next.indexOf(draggedEnv.current)
      const to = next.indexOf(envName)
      if (from < 0 || to < 0) return prev
      next.splice(from, 1)
      next.splice(to, 0, draggedEnv.current)
      return next
    })
  }

  function handleEnvDragEnd() {
    draggedEnv.current = null
    if (results) {
      setResults((prev) => {
        if (!prev) return prev
        const newOrder = envOrder.filter((e) => prev.envs.includes(e))
        const map = newOrder.map((e) => prev.envs.indexOf(e)).filter((i) => i >= 0)
        return {
          ...prev,
          envs: map.map((i) => prev.envs[i]),
          rows: prev.rows.map((r) => ({ ...r, cells: map.map((i) => r.cells[i]) })),
        }
      })
    }
  }

  // ── Fullscreen keyboard shortcut ────────────────────────────────────────────

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && fullscreen) { setFullscreen(false); return }
      if ((e.key === 'f' || e.key === 'F') && results) {
        const tag = (e.target?.tagName) || ''
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return
        e.preventDefault()
        setFullscreen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen, results])

  useEffect(() => {
    if (isActive) {
      document.body.classList.toggle('inspect-fullscreen', fullscreen)
    }
    return () => document.body.classList.remove('inspect-fullscreen')
  }, [fullscreen, isActive])

  // When switching away from inspect tab: temporarily remove the fullscreen
  // body class so the crypto view is visible. Restore it when coming back.
  useEffect(() => {
    if (!isActive) {
      document.body.classList.remove('inspect-fullscreen')
    } else if (fullscreen) {
      document.body.classList.add('inspect-fullscreen')
    }
  }, [isActive, fullscreen])
  // ── Table rendering ─────────────────────────────────────────────────────────

  const filteredRows = results ? results.rows.filter((r) => {
    if (filter && !r.key.toLowerCase().includes(filter.toLowerCase())) return false
    if (missingOnly && !r.missing) return false
    if (diffOnly && !r.different) return false
    return true
  }) : []

  const orderedEnvNames = envOrder.filter((e) => envs.has(e))

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className="card card-fill" id="inspectView">

      {/* ── Top zone: setup controls (scrollable if content overflows) ── */}
      {!fullscreen && (
        <div className="inspect-setup">
          <header className="inspector-header">
            <div>
              <h2 className="inspector-title">
                <Icon id="i-magnifying-glass" />
                <span>Properties Inspector</span>
              </h2>
              <p className="hint">Load property files across environments, configure decryption per env, and compare values side by side.</p>
            </div>
          </header>

          <div className="grid">
            <div className="field">
              <label htmlFor="envPattern">Env filename pattern</label>
              <input id="envPattern" type="text" value={envPattern} spellCheck={false} onChange={(e) => setEnvPattern(e.target.value)} />
              <small className="hint">Use <code>{'{env}'}</code> as placeholder. Regex allowed.</small>
            </div>
            <div className="field">
              <label htmlFor="securePattern">Secure env filename pattern</label>
              <input id="securePattern" type="text" value={securePattern} spellCheck={false} onChange={(e) => setSecurePattern(e.target.value)} />
              <small className="hint">Optional. Files matching this are flagged as encrypted.</small>
            </div>
          </div>

          <div className="field">
            <label>Files</label>
            <div
              className={`dropzone${dragover ? ' dragover' : ''}`}
              tabIndex={0}
              role="button"
              aria-label="Drop property files or a folder"
              onClick={handlePickFiles}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePickFiles() } }}
              onDragEnter={(e) => { e.preventDefault(); setDragover(true) }}
              onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
              onDragLeave={(e) => { e.preventDefault(); setDragover(false) }}
              onDrop={handleDropzoneDrop}
            >
              <Icon id="i-folder" size="lg" />
              <div>
                <strong>Drop property files or a folder here</strong>
                <div className="hint">
                  or{' '}
                  <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); handlePickFiles() }}>pick files</button>
                  {' · '}
                  <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); handlePickFolder() }}>pick folder</button>
                </div>
              </div>
            </div>
            <input id="inspectFileInput" type="file" multiple accept=".properties,.yaml,.yml,.txt" hidden onChange={handleFileInputChange} />
            <input id="inspectFolderInput" type="file" multiple hidden onChange={handleFileInputChange} />
          </div>

          {/* Env list */}
          {orderedEnvNames.length > 0 && (
            <div className="env-list-panel" id="envListPanel">
              <div className="env-list-toolbar">
                <small className="hint env-sort-hint">Drag any env card by its handle to reorder.</small>
              </div>
              <div className="env-list env-list-draggable" id="envList">
                {orderedEnvNames.map((envName) => {
                  const bucket = envs.get(envName)
                  if (!bucket) return null
                  const hasSecure = bucket.secureFiles.length > 0
                  const cfg = bucket.config
                  return (
                    <div
                      key={envName}
                      className="env-item"
                      draggable
                      data-env={envName}
                      onDragStart={(e) => handleEnvDragStart(e, envName)}
                      onDragOver={(e) => handleEnvDragOver(e, envName)}
                      onDragEnd={handleEnvDragEnd}
                    >
                      <div className="env-item-header">
                        <div className="env-name">
                          <span className="env-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
                          <span>{envName}</span>
                          {hasSecure && <span className="env-badge secure">secure</span>}
                          <span className="env-badge">{bucket.plainFiles.length + bucket.secureFiles.length} file(s)</span>
                        </div>
                        <button type="button" className="env-remove" title="Remove" onClick={() => removeEnv(envName)}>
                          <Icon id="i-trash" />
                        </button>
                      </div>
                      <div className="env-files">
                        {[...bucket.plainFiles, ...bucket.secureFiles].map((f) => (
                          <span key={f.name} className={`file-chip${f.secure ? ' secure' : ''}`}>{f.name}</span>
                        ))}
                      </div>
                      {hasSecure && (
                        <div className="env-config">
                          <div className="field">
                            <label>Secret key <span className="muted">(optional)</span></label>
                            <div className="input-group">
                              <span className="input-leading"><Icon id="i-key" /></span>
                              <input
                                type={cfg.show ? 'text' : 'password'}
                                value={cfg.key}
                                placeholder="Leave empty to keep values encrypted"
                                spellCheck={false}
                                onChange={(e) => updateEnvConfig(envName, { key: e.target.value })}
                              />
                              <button type="button" className="input-trailing" aria-label="Show or hide key"
                                onClick={() => updateEnvConfig(envName, { show: !cfg.show })}>
                                <Icon id={cfg.show ? 'i-eye-slash' : 'i-eye'} />
                              </button>
                            </div>
                          </div>
                          <div className="field">
                            <label>Algorithm</label>
                            <select value={cfg.algo} onChange={(e) => updateEnvConfig(envName, { algo: e.target.value })}>
                              {ALGOS.map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                          </div>
                          <div className="field">
                            <label>Mode</label>
                            <select value={cfg.mode} onChange={(e) => {
                              const m = e.target.value
                              updateEnvConfig(envName, { mode: m, ...(m === 'ECB' ? { randomIv: false } : {}) })
                            }}>
                              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={cfg.randomIv}
                              disabled={cfg.mode === 'ECB'}
                              onChange={(e) => updateEnvConfig(envName, { randomIv: e.target.checked })}
                            />
                            <span>Random IV</span>
                          </label>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={envs.size === 0} onClick={analyzeEnvs}>
              <Icon id="i-magnifying-glass" />
              <span>Analyze</span>
            </button>
            <button type="button" className="btn" onClick={clearInspector}>
              <Icon id="i-x-mark" />
              <span>Clear</span>
            </button>
          </div>

          <Status {...inspectStatus} />
        </div>
      )}

      {/* ── Results zone: fills remaining height, table scrolls inside ── */}
      {results && (
        <div className="inspect-results-zone" id="inspectResults">
          <div className="inspect-toolbar">
            <div className="input-group inspect-filter">
              <span className="input-leading"><Icon id="i-magnifying-glass" /></span>
              <input type="text" placeholder="Filter by key…" spellCheck={false} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
              <span>Missing only</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} />
              <span>Differences only</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} />
              <span>Reveal secrets</span>
            </label>
            <button type="button" className="btn btn-sm" title={fullscreen ? 'Exit fullscreen (Esc or F)' : 'Fullscreen (press F or Esc to exit)'}
              onClick={() => setFullscreen((v) => !v)}>
              <Icon id={fullscreen ? 'i-arrows-collapse' : 'i-arrows-expand'} />
              <span>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
            </button>
          </div>

          <div className="inspect-summary" id="inspectSummary">
            <span className="pill">{results.envs.length} env(s)</span>
            <span className="pill">{results.rows.length} key(s)</span>
            <span className="pill ok">{results.rows.filter((r) => !r.missing && !r.different && !r.anyEncrypted).length} identical</span>
            <span className="pill diff">{results.rows.filter((r) => r.different).length} differing</span>
            <span className="pill missing">{results.rows.filter((r) => r.missing).length} missing</span>
            {results.rows.some((r) => r.anyEncrypted) && (
              <span className="pill encrypted">{results.rows.filter((r) => r.anyEncrypted).length} encrypted</span>
            )}
            <span className="muted">Showing {filteredRows.length} row(s).</span>
          </div>

          <div className="inspect-table-wrap">
            <table className="inspect-table" id="inspectTable">
              <colgroup>
                <col style={{ width: `${results.envs.length <= 3 ? 26 : results.envs.length <= 6 ? 20 : 16}%` }} />
                {results.envs.map((e) => (
                  <col key={e} style={{ width: `${(100 - (results.envs.length <= 3 ? 26 : results.envs.length <= 6 ? 20 : 16)) / results.envs.length}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="key-col">Property ({results.rows.length})</th>
                  {results.envs.map((e) => <th key={e}>{e}</th>)}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.key}>
                    <td
                      className="key-col"
                      title={row.key}
                      onClick={() => setDialog({ propName: row.key, env: null, cell: null, row, allEnvs: results.envs })}
                    >
                      {row.key}
                    </td>
                    {row.cells.map((cell, i) => {
                      const env = results.envs[i]
                      const revealKey = `${row.key}|${env}`
                      const isRevealed = revealAll || revealed.has(revealKey)

                      if (cell.missing) {
                        return (
                          <td key={env} className="missing" title="—"
                            onClick={() => setDialog({ propName: row.key, env, cell, row, allEnvs: results.envs })}>
                            —
                          </td>
                        )
                      }

                      const cls = [
                        cell.error ? 'error' : cell.encrypted ? 'encrypted' : '',
                        row.different && !cell.missing && !cell.encrypted && !cell.error ? 'diff' : '',
                      ].filter(Boolean).join(' ')

                      return (
                        <td key={env} className={cls}
                          onClick={() => setDialog({ propName: row.key, env, cell, row, allEnvs: results.envs })}>
                          {cell.error
                            ? `⚠ ${cell.error}`
                            : cell.encrypted
                              ? <span className="val-enc" title="Encrypted — no key provided">🔒 {cell.value}</span>
                              : cell.secure
                                ? (
                                  <span
                                    className={`val-secret${isRevealed ? ' revealed' : ''}`}
                                    title={isRevealed ? 'Click to hide' : 'Click to reveal'}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setRevealed((prev) => {
                                        const next = new Set(prev)
                                        next.has(revealKey) ? next.delete(revealKey) : next.add(revealKey)
                                        return next
                                      })
                                    }}
                                  >
                                    {isRevealed ? cell.value : ''}
                                  </span>
                                )
                                : cell.value
                          }
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Value dialog */}
      {dialog && (
        <ValueDialog
          {...dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  )
}
