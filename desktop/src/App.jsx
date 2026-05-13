import { useState, useEffect, useRef } from 'react'
import { IconSprite, Icon } from './components/Icons'
import CryptoView from './components/CryptoView'
import InspectView from './components/InspectView'
import { InfoCrypto, InfoInspect } from './components/InfoCards'

export default function App() {
  const [view, setView] = useState('crypto')   // 'crypto' | 'inspect'
  const [aboutOpen, setAboutOpen] = useState(false)
  const aboutRef = useRef(null)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') }
    catch { return 'light' }
  })
  const [inspectWide, setInspectWide] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch (_) {}
    window.electronAPI?.onThemeChanged(theme)
  }, [theme])

  // Close about popup when clicking outside
  useEffect(() => {
    if (!aboutOpen) return
    function handleClick(e) {
      if (aboutRef.current && !aboutRef.current.contains(e.target)) {
        setAboutOpen(false)
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setAboutOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [aboutOpen])

  function toggleTheme() {
    setTheme((t) => t === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className={`app-shell platform-${window.electronAPI?.platform ?? 'web'}`}>
      <IconSprite />

      {/* ── Header ── */}
      <header className="topbar">
        <div className="header-inner">
          <div className="brand">
            <span className="logo">
              <img src="./favicon.svg" alt="" width="32" height="32" />
            </span>
            <div>
              <h1>MuleSoft Properties Manager</h1>
              <p className="subtitle">Encrypt, decrypt, and compare Mule property files.</p>
            </div>
          </div>

          <div className="header-right">
            {/* View switcher lives in the header to save vertical space */}
            <nav className="view-switch" role="tablist" aria-label="Tool">
              {[
                { id: 'crypto',  icon: 'i-lock-closed',     label: 'Secure Properties' },
                { id: 'inspect', icon: 'i-magnifying-glass', label: 'Inspect Properties' },
              ].map(({ id, icon, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`view-tab${view === id ? ' active' : ''}`}
                  role="tab"
                  aria-selected={view === id}
                  onClick={() => setView(id)}
                >
                  <Icon id={icon} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>

            <button
              type="button"
              className="btn btn-icon"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={toggleTheme}
            >
              <Icon id="i-sun" className="icon theme-icon-light" />
              <Icon id="i-moon" className="icon theme-icon-dark" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Scrollable area: card + info strip ── */}
      <div className="app-scroll">
        <div className={`app-body${view === 'inspect' && inspectWide ? ' inspect-wide' : ''}`}>
          <div className="app-card-col">
            {/* Both views stay mounted to preserve state — only visibility toggles.
                When inspect is in fullscreen (position:fixed, z-index:100), the
                crypto wrapper gets z-index:101 so it renders on top. */}
            <div className={`view-slot${view === 'crypto' ? ' view-slot-active' : ''}`}>
              <CryptoView />
            </div>
            <div className={`view-slot${view === 'inspect' ? ' view-slot-active' : ''}`}>
              <InspectView isWide={inspectWide} onWideChange={setInspectWide} isActive={view === 'inspect'} />
            </div>
          </div>
        </div>

        {/* ── Info strip at the bottom — always visible ── */}
        <div className="app-info-strip">
          {view === 'crypto'  && <InfoCrypto />}
          {view === 'inspect' && <InfoInspect />}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer
        className="app-footer app-footer--clickable"
        onClick={() => setAboutOpen((o) => !o)}
        title="About this app"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setAboutOpen((o) => !o)}
        aria-expanded={aboutOpen}
        aria-haspopup="dialog"
      >
        <span>Runs entirely on your machine. Not affiliated with MuleSoft or Salesforce.</span>
      </footer>

      {/* ── About popup ── */}
      {aboutOpen && (
        <div className="about-overlay" role="presentation">
          <div
            ref={aboutRef}
            className="about-popup"
            role="dialog"
            aria-modal="true"
            aria-label="About MuleSoft Properties Manager"
          >
            <button
              className="about-popup__close btn btn-icon"
              aria-label="Close"
              onClick={() => setAboutOpen(false)}
            >
              <Icon id="i-x-mark" />
            </button>
            <h2 className="about-popup__title">MuleSoft Properties Manager</h2>
            <p className="about-popup__tagline">Brought to you by</p>
            <p className="about-popup__author">
              <a
                href="https://www.linkedin.com/in/ynesel/"
                onClick={(e) => {
                  e.preventDefault()
                  const url = 'https://www.linkedin.com/in/ynesel/'
                  window.electronAPI?.openExternal(url) ?? window.open(url, '_blank', 'noopener,noreferrer')
                }}
              >
                Younesse EL MANSOURI
              </a>
            </p>
            <p className="about-popup__email">
              <a href="mailto:younesse@elmansouri.me">younesse@elmansouri.me</a>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
