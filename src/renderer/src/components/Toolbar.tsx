import type { CropRect, OpenedDocument } from '../types'
import { CloseIcon, HelpIcon } from './icons'

interface ToolbarProps {
  doc: OpenedDocument | null
  busy: boolean
  onOpen: () => void
  /** Open the Save canvas dialog. */
  onOpenSave: () => void
  /** Active document crop, or null when no crop is applied. */
  cropRect: CropRect | null
  /** Clear the crop and restore the full document view. */
  onResetCrop: () => void
  /** Open the keyboard shortcuts modal. */
  onOpenShortcuts: () => void
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function Toolbar({
  doc,
  busy,
  onOpen,
  onOpenSave,
  cropRect,
  onResetCrop,
  onOpenShortcuts,
}: ToolbarProps) {
  const w = doc?.parsed.width
  const h = doc?.parsed.height
  const isEvenSize = w !== undefined && h !== undefined && w % 2 === 0 && h % 2 === 0
  const at1x = isEvenSize ? `${w! / 2} × ${h! / 2}` : null
  const totalLeafCount = doc?.parsed.totalLeafCount ?? 0

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="dot" />
        <span className="name">Loupe</span>
      </div>
      <div className="doc-info">
        {doc ? (
          <>
            <span className="filename">{basename(doc.filePath)}</span>
            <span className="sep">•</span>
            <span className="dims">
              {cropRect ? (
                <>
                  {cropRect.w} × {cropRect.h} px
                  <span className="muted">  (of full {w} × {h})</span>
                </>
              ) : (
                <>
                  {w} × {h} px
                  {at1x && (
                    <>
                      <span className="muted"> @2x · </span>
                      <span className="muted">@1x {at1x}</span>
                    </>
                  )}
                </>
              )}
            </span>
            <span className="sep">•</span>
            <span className="muted">{totalLeafCount} layers</span>
            {cropRect && (
              <button
                className="crop-pill"
                onClick={onResetCrop}
                title="Reset crop"
                type="button"
              >
                <span className="crop-pill-label">
                  Cropped {cropRect.w} × {cropRect.h}
                </span>
                <span className="crop-pill-x" aria-hidden>
                  <CloseIcon size={13} />
                </span>
              </button>
            )}
          </>
        ) : (
          <span className="muted">No file open</span>
        )}
      </div>
      <div className="actions">
        <button
          className="icon-btn toolbar-help"
          onClick={onOpenShortcuts}
          title="Keyboard shortcuts (⌘/)"
          aria-label="Keyboard shortcuts"
        >
          <HelpIcon size={16} />
        </button>
        <button className="btn" onClick={onOpen} disabled={busy} title="Open a file (⌘O)">
          {busy ? 'Opening…' : 'Open'}
        </button>
        <button
          className="btn primary"
          onClick={onOpenSave}
          disabled={!doc || busy}
          title="Save canvas (⌘S)"
        >
          Save
        </button>
      </div>
    </header>
  )
}
