import { Fragment, useEffect } from 'react'
import { CloseIcon } from './icons'

interface ShortcutSection {
  title: string
  items: { keys: string; label: string }[]
}

const SECTIONS: ShortcutSection[] = [
  {
    title: 'Tools',
    items: [
      { keys: 'V', label: 'Select' },
      { keys: 'M', label: 'Marquee' },
      { keys: 'H', label: 'Hand' },
      { keys: 'E', label: 'Eraser' },
      { keys: 'Hold Space', label: 'Temporary Hand' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: '⌘ =', label: 'Zoom in' },
      { keys: '⌘ -', label: 'Zoom out' },
      { keys: '⌘ 0', label: 'Actual size (100%)' },
      { keys: '⌘ 1', label: 'Fit to window' },
      { keys: 'G', label: 'Toggle grid' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: 'Click', label: 'Select layer' },
      { keys: 'Shift + click', label: 'Add / remove from selection' },
      { keys: '⌘ + click', label: 'Solo layer' },
      { keys: 'Arrow keys', label: 'Nudge selected layers (1 px)' },
      { keys: 'Shift + arrow', label: 'Nudge 10 px' },
      { keys: 'Esc', label: 'Clear marquee / selection' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { keys: '⌘ Z', label: 'Undo' },
      { keys: 'Delete', label: 'Erase marquee region (single layer selected)' },
      { keys: '[  /  ]', label: 'Resize eraser brush' },
    ],
  },
  {
    title: 'File',
    items: [
      { keys: '⌘ O', label: 'Open PSD / PNG / JPG (in a new tab)' },
      { keys: '⌘ S', label: 'Save canvas as PNG / JPG' },
    ],
  },
  {
    title: 'Canvas',
    items: [
      { keys: 'Two-finger / ⌃ + click', label: 'Right-click → Trim to layer' },
      { keys: 'Wheel / pinch', label: 'Zoom around cursor' },
    ],
  },
  {
    title: 'Help',
    items: [{ keys: '⌘ /', label: 'Show this shortcut list' }],
  },
]

interface Props {
  onClose: () => void
}

export function ShortcutsModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </header>
        <div className="modal-body shortcuts-body">
          {SECTIONS.map((s) => (
            <section key={s.title} className="shortcuts-section">
              <h3 className="shortcuts-section-title">{s.title}</h3>
              <dl className="shortcuts-list">
                {s.items.map((item) => (
                  <Fragment key={item.label}>
                    <dt>
                      <kbd>{item.keys}</kbd>
                    </dt>
                    <dd>{item.label}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
