import { Icon } from './Icons'

/**
 * Flash message bar — mirrors the .status element from the original.
 * kind: 'ok' | 'error' | 'info' | null
 */
export default function Status({ msg, kind }) {
  if (!msg) return null

  const iconId =
    kind === 'error' ? 'i-exclamation-triangle'
    : kind === 'ok'  ? 'i-check'
    :                  'i-information-circle'

  return (
    <div className={`status visible${kind ? ' ' + kind : ''}`} role="status" aria-live="polite">
      <Icon id={iconId} />
      <span>{msg}</span>
    </div>
  )
}
