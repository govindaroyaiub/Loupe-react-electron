import { useEffect, useMemo, useState } from 'react'
import type { LayerNode } from '../types'
import type { BackgroundFill, ExportFormat, ExportOptions } from '../lib/export'
import { planExports, renderLayerToBytes } from '../lib/export'
import { ArrowRightIcon, CloseIcon } from './icons'

interface ExportModalProps {
  layers: LayerNode[]
  baseName: string
  is2x: boolean
  /** Live editable canvases by layer id — used so exports reflect erasures. */
  editedCanvases: Map<string, HTMLCanvasElement>
  onClose: () => void
}

interface ExportProgress {
  total: number
  done: number
  current?: string
  error?: string
}

export function ExportModal({
  layers,
  baseName,
  is2x,
  editedCanvases,
  onClose,
}: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [scalePreset, setScalePreset] = useState<string>(is2x ? '0.5' : '1')
  const [customScale, setCustomScale] = useState<string>('100')
  const [background, setBackground] = useState<BackgroundFill>('transparent')
  const [jpegQuality, setJpegQuality] = useState<number>(0.92)
  const [progress, setProgress] = useState<ExportProgress | null>(null)

  const scale = useMemo(() => {
    if (scalePreset === 'custom') {
      const n = Number(customScale)
      if (!Number.isFinite(n) || n <= 0) return 1
      return n / 100
    }
    return Number(scalePreset)
  }, [scalePreset, customScale])

  const opts: ExportOptions = useMemo(
    () => ({
      format,
      scale,
      background: format === 'jpeg' && background === 'transparent' ? 'white' : background,
      jpegQuality,
    }),
    [format, scale, background, jpegQuality],
  )

  const plan = useMemo(() => planExports(layers, opts, baseName), [layers, opts, baseName])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !progress) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, progress])

  async function startExport() {
    if (plan.length === 0) return
    let destDir: string | null = null
    let singleDestPath: string | null = null

    if (plan.length === 1) {
      singleDestPath = await window.loupe.showSaveDialog({
        defaultPath: plan[0].filename,
        filters: [
          {
            name: opts.format === 'png' ? 'PNG' : 'JPEG',
            extensions: [opts.format === 'png' ? 'png' : 'jpg'],
          },
        ],
      })
      if (!singleDestPath) return
    } else {
      destDir = await window.loupe.showFolderDialog({})
      if (!destDir) return
    }

    setProgress({ total: plan.length, done: 0 })
    try {
      let firstWritten: string | null = null
      for (let i = 0; i < plan.length; i++) {
        const item = plan[i]
        setProgress({ total: plan.length, done: i, current: item.filename })
        const bytes = await renderLayerToBytes(
          item.layer,
          opts,
          editedCanvases.get(item.layer.id),
        )
        const dest = singleDestPath ?? `${destDir}/${item.filename}`
        await window.loupe.writeFile(dest, bytes)
        if (i === 0) firstWritten = dest
      }
      setProgress({ total: plan.length, done: plan.length })
      if (firstWritten) {
        await window.loupe.showInFolder(firstWritten)
      }
      onClose()
    } catch (err) {
      setProgress((p) =>
        p ? { ...p, error: err instanceof Error ? err.message : String(err) } : null,
      )
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !progress && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Export {plan.length} {plan.length === 1 ? 'layer' : 'layers'}</h2>
          <button className="icon-btn" onClick={onClose} disabled={!!progress} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="modal-body">
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
                  value={jpegQuality}
                  onChange={(e) => setJpegQuality(Number(e.target.value))}
                />
                <span className="numeric">{Math.round(jpegQuality * 100)}</span>
              </div>
            </div>
          )}

          <div className="form-row">
            <label>Scale</label>
            <div className="scale-options">
              {is2x && (
                <label className="radio">
                  <input
                    type="radio"
                    name="scale"
                    value="0.5"
                    checked={scalePreset === '0.5'}
                    onChange={(e) => setScalePreset(e.target.value)}
                  />
                  <span>50% — actual @1x</span>
                </label>
              )}
              <label className="radio">
                <input
                  type="radio"
                  name="scale"
                  value="1"
                  checked={scalePreset === '1'}
                  onChange={(e) => setScalePreset(e.target.value)}
                />
                <span>100% — source{is2x ? ' @2x' : ''}</span>
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="scale"
                  value="0.25"
                  checked={scalePreset === '0.25'}
                  onChange={(e) => setScalePreset(e.target.value)}
                />
                <span>25%</span>
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="scale"
                  value="custom"
                  checked={scalePreset === 'custom'}
                  onChange={(e) => setScalePreset(e.target.value)}
                />
                <span>Custom</span>
                <input
                  type="number"
                  className="num-input"
                  min={1}
                  max={1000}
                  value={customScale}
                  onChange={(e) => {
                    setCustomScale(e.target.value)
                    setScalePreset('custom')
                  }}
                />
                <span className="muted">%</span>
              </label>
            </div>
          </div>

          <div className="form-row">
            <label>Background</label>
            <div className="seg">
              {format === 'png' && (
                <button
                  className={background === 'transparent' ? 'active' : ''}
                  onClick={() => setBackground('transparent')}
                >
                  Transparent
                </button>
              )}
              <button
                className={background === 'white' ? 'active' : ''}
                onClick={() => setBackground('white')}
              >
                White
              </button>
              <button
                className={background === 'black' ? 'active' : ''}
                onClick={() => setBackground('black')}
              >
                Black
              </button>
            </div>
          </div>

          <div className="preview">
            <div className="preview-header">
              <span>Output ({plan.length})</span>
            </div>
            <div className="preview-list">
              {plan.slice(0, 8).map((p, idx) => (
                <div key={idx} className="preview-item">
                  <span className="preview-name" title={p.filename}>
                    {p.filename}
                  </span>
                  <span className="preview-dim">
                    {p.width} × {p.height} px
                  </span>
                </div>
              ))}
              {plan.length > 8 && (
                <div className="preview-item muted">…and {plan.length - 8} more</div>
              )}
            </div>
          </div>

          {progress && (
            <div className="progress">
              {progress.error ? (
                <span className="err">Error: {progress.error}</span>
              ) : progress.done < progress.total ? (
                <span>
                  Exporting {progress.done + 1} / {progress.total}: {progress.current}
                </span>
              ) : (
                <span>Done.</span>
              )}
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <button className="btn" onClick={onClose} disabled={!!progress && !progress.error}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={startExport}
            disabled={!!progress && !progress.error}
          >
            {progress && !progress.error ? (
              `${progress.done}/${progress.total}…`
            ) : (
              <span className="btn-with-icon">
                Export <ArrowRightIcon size={14} />
              </span>
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
