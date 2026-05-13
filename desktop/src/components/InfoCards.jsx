import { useState } from 'react'
import { Icon } from './Icons'

function InfoCard({ id, children }) {
  const [open, setOpen] = useState(false)

  return (
    <section className={`card info info-collapsible${open ? ' info-open' : ''}`} id={id}>
      <button
        type="button"
        className="info-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="info-toggle-left">
          <Icon id="i-information-circle" />
          <span>How it works</span>
        </span>
        <Icon id={open ? 'i-x-mark' : 'i-arrow-path'} className="icon info-chevron" />
      </button>

      {open && (
        <div className="info-body">
          {children}
        </div>
      )}
    </section>
  )
}

export function InfoCrypto() {
  return (
    <InfoCard id="infoCrypto">
      <p>
        This tool mirrors the two methods of the MuleSoft{' '}
        <code>secure-properties-tool.jar</code>:
      </p>
      <ul className="method-list">
        <li><strong>String</strong> — encrypt or decrypt a single value, the same output you'd wrap in <code>![...]</code> inside a property file.</li>
        <li><strong>File</strong> — process a <code>.properties</code> or <code>.yaml</code> file, encrypting or decrypting every value at once.</li>
      </ul>
      <p>
        Keys are read as raw UTF-8 bytes, PKCS5/PKCS7 padding is applied, and
        output is Base64 encoded. The IV is either derived from the key or
        randomly generated and prepended to the ciphertext.
      </p>
      <p>
        Wrap the value in your Mule property file as{' '}
        <code>![encryptedValue]</code> so the Secure Configuration Properties
        module decrypts it at runtime.
      </p>
      <p className="disclaimer">
        Everything runs locally on your machine. No values are sent anywhere.
      </p>
    </InfoCard>
  )
}

export function InfoInspect() {
  return (
    <InfoCard id="infoInspect">
      <p>
        Compare property files across environments side by side and spot
        drift before it becomes an incident:
      </p>
      <ul className="method-list">
        <li><strong>Load</strong> — drop files or a folder. Environments are detected from the filename with a <code>{'{env}'}</code> pattern (e.g. <code>{'{env}'}-configuration.yaml</code>).</li>
        <li><strong>Secure files</strong> — a second pattern flags encrypted configs. Provide a per-env key, algorithm, mode, and IV option to decrypt them.</li>
        <li><strong>Compare</strong> — every key shows up in a single row with one column per env. Missing values are highlighted red, differing values yellow, and cells with no key stay encrypted in blue.</li>
      </ul>
      <p>
        Click any cell or key to see the full value in a popup, with a copy
        button. Toggle fullscreen for a clearer table, or mask and reveal
        decrypted secrets one cell at a time.
      </p>
      <p>
        Supports nested YAML maps, block sequences, and the{' '}
        <code>.properties</code> format. Encrypted list items are decrypted
        per element.
      </p>
      <p className="disclaimer">
        Everything runs locally on your machine. Files and keys never leave your machine.
      </p>
    </InfoCard>
  )
}
