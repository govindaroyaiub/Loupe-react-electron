import { useEffect, useMemo, useState } from 'react'
import type { DisplayBounds, LayerOffset, ParsedPsd } from '../types'
import { compositeVisible } from '../lib/composite'
import { ArrowRightIcon, CloseIcon } from './icons'

type Format = 'png' | 'jpeg'
type ScaleChoice = '1x' | '2x'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

interface Props {
  doc: ParsedPsd
  baseName: string
  visibility: Record<string, boolean>
  offsets: Record<string, LayerOffset>
  displayBounds: DisplayBounds
  editedCanvases: Map<string, HTMLCanvasElement>
  is2x: boolean
  onClose: () => void
}

export function SaveAsModal({
  doc,
  baseName,
  visibility,
  offsets,
  displayBounds,
  editedCanvases,
  is2x,
  onClose,
}: Props) {
  const [format, setFormat] = useState<Format>('png')
  // Default @1x when the source is @2x (typical "deliver retina + 1x")
  // so a single ⌘S gets the @1x output that's most often needed.
  const [scaleChoice, setScaleChoice] = useState<ScaleChoice>(is2x ? '1x' : '2x')
  const [quality, setQuality] = useState(0.92)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Estimated output file size in bytes. Null while a fresh estimate is
  // being computed (debounced — see effect below).
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null)

  // Preview is composited at full source resolution once and scaled by CSS
  // for display. Re-renders when visibility / offsets / crop / edits change.
  const previewCanvas = useMemo(
    () => compositeVisible(doc, visibility, offsets, displayBounds, editedCanvases, 1),
    [doc, visibility, offsets, displayBounds, editedCanvases],
  )
  const previewSrc = useMemo(() => previewCanvas.toDataURL('image/png'), [previewCanvas])

  const outScale = scaleChoice === '1x' ? 0.5 : 1
  const outW = Math.max(1, Math.round(displayBounds.w * outScale))
  const outH = Math.max(1, Math.round(displayBounds.h * outScale))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // Estimate the output file size by actually encoding at the chosen
  // format/quality/scale. Debounced so dragging the JPG quality slider
  // doesn't spin the CPU.
  useEffect(() => {
    let cancelled = false
    setEstimatedSize(null)
    const handle = window.setTimeout(() => {
      if (cancelled) return
      const c = compositeVisible(
        doc,
        visibility,
        offsets,
        displayBounds,
        editedCanvases,
        outScale,
      )
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      c.toBlob(
        (blob) => {
          if (cancelled) return
          setEstimatedSize(blob ? blob.size : null)
        },
        mime,
        format === 'jpeg' ? quality : undefined,
      )
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [doc, visibility, offsets, displayBounds, editedCanvases, format, quality, outScale])

  async function save() {
    if (busy) return
    setError(null)
    const ext = format === 'png' ? 'png' : 'jpg'
    const suffix = scaleChoice === '1x' && is2x ? '@1x' : ''
    const defaultName = `${baseName}${suffix}.${ext}`
    const dest = await window.loupe.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: format === 'png' ? 'PNG' : 'JPEG', extensions: [ext] }],
    })
    if (!dest) return
    setBusy(true)
    try {
      const outCanvas = compositeVisible(
        doc,
        visibility,
        offsets,
        displayBounds,
        editedCanvases,
        outScale,
      )
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      const blob: Blob | null = await new Promise((resolve) =>
        outCanvas.toBlob(resolve, mime, format === 'jpeg' ? quality : undefined),
      )
      if (!blob) throw new Error('Encode failed')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      await window.loupe.writeFile(dest, bytes)
      await window.loupe.showInFolder(dest)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal save-as-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Save canvas</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="modal-body">
          <div className="save-as-preview">
            <img src={previewSrc} alt="Canvas preview" />
          </div>

          <div className="form-row">
            <label>Format</label>
            <div className="seg">
              <button
                className={format === 'png' ? 'active' : ''}
                onClick={() => setFormat('png')}
              >
                PNG
              </button>
              <button
                className={format === 'jpeg' ? 'active' : ''}
                onClick={() => setFormat('jpeg')}
              >
                JPG
              </button>
            </div>
          </div>

          {format === 'jpeg' && (
            <div className="form-row">
              <label>Quality</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
                <span className="numeric">{Math.round(quality * 100)}</span>
              </div>
            </div>
          )}

          <div className="form-row">
            <label>Size</label>
            <div className="scale-options">
              {is2x && (
                <label className="radio">
                  <input
                    type="radio"
                    name="save-as-scale"
                    value="1x"
                    checked={scaleChoice === '1x'}
                    onChange={() => setScaleChoice('1x')}
                  />
                  <span>
                    @1x — {Math.round(displayBounds.w / 2)} × {Math.round(displayBounds.h / 2)} px
                  </span>
                </label>
              )}
              <label className="radio">
                <input
                  type="radio"
                  name="save-as-scale"
                  value="2x"
                  checked={scaleChoice === '2x'}
                  onChange={() => setScaleChoice('2x')}
                />
                <span>
                  {is2x ? '@2x — ' : ''}source — {displayBounds.w} × {displayBounds.h} px
                </span>
              </label>
            </div>
          </div>

          <div className="save-as-output">
            Output: <strong>{outW} × {outH} px</strong> ·{' '}
            {format === 'png' ? 'PNG (lossless)' : `JPG ${Math.round(quality * 100)}%`}
            {' · '}
            {estimatedSize === null ? (
              <span className="muted">calculating size…</span>
            ) : (
              <strong>~{formatBytes(estimatedSize)}</strong>
            )}
          </div>

          {error && <div className="progress"><span className="err">Error: {error}</span></div>}
        </div>

        <footer className="modal-footer">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? (
              'Saving…'
            ) : (
              <span className="btn-with-icon">
                Save <ArrowRightIcon size={14} />
              </span>
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
