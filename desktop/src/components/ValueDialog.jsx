import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icons'

// NOTE: prop is named `propName` (not `key`) because `key` is reserved by React
// and gets stripped — it never arrives in the component.
export default function ValueDialog({ propName, env, cell, row, allEnvs, onClose }) {
  const dialogRef = useRef(null)
  const [copyLabel, setCopyLabel] = useState('Copy')

  useEffect(() => {
    const el = dialogRef.current
    if (el && typeof el.showModal === 'function') el.showModal()
    return () => { if (el && el.open) el.close() }
  }, [])

  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleCopy(text) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy'), 2000)
    } catch {
      setCopyLabel('Failed')
      setTimeout(() => setCopyLabel('Copy'), 2000)
    }
  }

  // ── Key column click: show the property path ──────────────────────────────
  if (!env) {
    return (
      <dialog ref={dialogRef} className="value-dialog" aria-labelledby="vdTitle"
        onClick={(e) => { if (e.target === dialogRef.current) onClose() }}>
        <div className="value-dialog-inner">
          <header className="value-dialog-header">
            <div>
              <div className="value-dialog-eyebrow">Property key</div>
              <h3 id="vdTitle" className="value-dialog-title">{propName}</h3>
              <div className="value-dialog-meta">
                <span className="pill">{allEnvs.length} env(s)</span>
                {row.missing  && <span className="pill missing">missing in some env</span>}
                {row.different && <span className="pill encrypted">differs across envs</span>}
                {row.anySecure && <span className="pill secure">secure</span>}
              </div>
            </div>
            <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>
              <Icon id="i-x-mark" />
            </button>
          </header>

          <div className="cell-detail-meta">
            <div className="cell-detail-row">
              <span className="cell-detail-label">Key</span>
              <code className="cell-detail-value cell-detail-value-main">{propName}</code>
            </div>
            <div className="cell-detail-row">
              <span className="cell-detail-label">Environments</span>
              <code className="cell-detail-value">{allEnvs.join(', ')}</code>
            </div>
          </div>

          <footer className="value-dialog-footer">
            <div className="status" />
            <div className="value-dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => handleCopy(propName)}>
                <Icon id="i-clipboard" /><span>{copyLabel}</span>
              </button>
              <button type="button" className="btn" onClick={onClose}>Close</button>
            </div>
          </footer>
        </div>
      </dialog>
    )
  }

  // ── Cell click: show key / env / value ────────────────────────────────────
  const isMissing = !cell || cell.missing
  const copyValue = isMissing ? '' : (cell.value != null ? String(cell.value) : '')

  const pills = []
  if (isMissing)                          pills.push(<span key="m"   className="pill missing">missing</span>)
  if (cell?.secure && !cell?.encrypted)   pills.push(<span key="s"   className="pill secure">decrypted secret</span>)
  if (cell?.encrypted)                    pills.push(<span key="e"   className="pill encrypted">encrypted — no key</span>)
  if (cell?.error)                        pills.push(<span key="err" className="pill error">decryption error</span>)
  if (cell?.sourceFile)                   pills.push(<span key="f"   className="pill">{cell.sourceFile}</span>)

  let displayValue = ''
  if (isMissing)   displayValue = '(not defined in this environment)'
  else if (cell.error) displayValue = `${cell.error}\n\nCiphertext: ${cell.value}`
  else             displayValue = copyValue

  return (
    <dialog ref={dialogRef} className="value-dialog" aria-labelledby="vdTitle"
      onClick={(e) => { if (e.target === dialogRef.current) onClose() }}>
      <div className="value-dialog-inner">
        <header className="value-dialog-header">
          <div>
            <div className="value-dialog-eyebrow">Cell value</div>
            <h3 id="vdTitle" className="value-dialog-title">{propName}</h3>
            <div className="value-dialog-meta">{pills}</div>
          </div>
          <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>
            <Icon id="i-x-mark" />
          </button>
        </header>

        {/* Key / Environment / Value detail rows */}
        <div className="cell-detail-meta">
          <div className="cell-detail-row">
            <span className="cell-detail-label">Key</span>
            <code className="cell-detail-value">{propName}</code>
          </div>
          <div className="cell-detail-row">
            <span className="cell-detail-label">Environment</span>
            <code className="cell-detail-value">{env}</code>
          </div>
          <div className="cell-detail-row">
            <span className="cell-detail-label">Value</span>
            <code className={`cell-detail-value${isMissing ? '' : ' cell-detail-value-main'}`}>
              {displayValue}
            </code>
          </div>
        </div>

        <footer className="value-dialog-footer">
          <div className="status" />
          <div className="value-dialog-actions">
            <button type="button" className="btn btn-primary" disabled={isMissing}
              onClick={() => handleCopy(copyValue)}>
              <Icon id="i-clipboard" /><span>{copyLabel}</span>
            </button>
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </footer>
      </div>
    </dialog>
  )
}
