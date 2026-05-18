import { useEffect } from 'react'

interface Props {
  onClose: () => void
}

export function WelcomeModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal welcome-modal" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-body">
          <h2 className="welcome-title">Welcome to Loupe</h2>
          <p className="welcome-text">A precision inspector for HTML5 banner designers.</p>
          <ul className="welcome-bullets">
            <li>
              <strong>Open</strong> PSDs, PNGs, or JPGs — multiple at once, each in its own tab.
            </li>
            <li>
              <strong>Measure</strong> with the marquee or drop guides from the rulers to get
              CSS coordinates at @1x or @2x.
            </li>
            <li>
              <strong>Save</strong> the canvas as PNG / JPG with crop and trim baked in.
            </li>
          </ul>
          <p className="welcome-hint">
            Press <kbd>⌘ /</kbd> any time to see the full shortcut list.
          </p>
          <button className="btn primary large welcome-btn" onClick={onClose}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}
