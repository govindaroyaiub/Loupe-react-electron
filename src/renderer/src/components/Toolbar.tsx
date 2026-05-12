import type { OpenedDocument } from '../types'

interface ToolbarProps {
  doc: OpenedDocument | null
  busy: boolean
  selectionCount: number
  totalLeafCount: number
  onOpen: () => void
  onExport: () => void
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function Toolbar({
  doc,
  busy,
  selectionCount,
  totalLeafCount,
  onOpen,
  onExport,
}: ToolbarProps) {
  const w = doc?.parsed.width
  const h = doc?.parsed.height
  const isEvenSize = w !== undefined && h !== undefined && w % 2 === 0 && h % 2 === 0
  const at1x = isEvenSize ? `${w! / 2} × ${h! / 2}` : null

  const exportLabel =
    selectionCount > 0 ? `Export ${selectionCount}` : `Export all (${totalLeafCount})`

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
              {w} × {h} px
              {at1x && (
                <>
                  <span className="muted"> @2x · </span>
                  <span className="muted">@1x {at1x}</span>
                </>
              )}
            </span>
            <span className="sep">•</span>
            <span className="muted">{totalLeafCount} layers</span>
          </>
        ) : (
          <span className="muted">No file open</span>
        )}
      </div>
      <div className="actions">
        <button className="btn" onClick={onOpen} disabled={busy}>
          {busy ? 'Opening…' : 'Open PSD'}
        </button>
        <button className="btn primary" onClick={onExport} disabled={!doc || busy}>
          {exportLabel}
        </button>
      </div>
    </header>
  )
}
