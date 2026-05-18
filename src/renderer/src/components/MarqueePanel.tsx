import { useState } from 'react'
import type { DisplayBounds, MarqueeRect } from '../types'
import { CloseIcon } from './icons'

interface MarqueePanelProps {
  rect: MarqueeRect
  /**
   * Visible document bounds — the rect (in absolute doc coords) is translated
   * into this space for display, and `%` snippets use it as the denominator.
   */
  displayBounds: DisplayBounds
  is2x: boolean
  onClear: () => void
  /** Apply the current marquee as the document crop. */
  onApplyCrop: (rect: MarqueeRect) => void
  /** Erase the marquee region from the single selected layer (Delete). */
  onTakeOut: () => void
  /** Whether onTakeOut would do something. False if 0 or >1 layers selected. */
  canTakeOut: boolean
}

function round(n: number, digits = 0): number {
  const f = Math.pow(10, digits)
  return Math.round(n * f) / f
}

interface Snippet {
  label: string
  text: string
  hint: string
}

function snippetsFor(
  rect: MarqueeRect,
  displayBounds: DisplayBounds,
  unit: '1x' | '2x',
  mode: 'px' | 'pct',
): Snippet[] {
  const scale = unit === '1x' ? 0.5 : 1
  const localX = rect.x - displayBounds.x
  const localY = rect.y - displayBounds.y
  const x = round(localX * scale, 1)
  const y = round(localY * scale, 1)
  const w = round(rect.width * scale, 1)
  const h = round(rect.height * scale, 1)
  const cx = round((localX + rect.width / 2) * scale, 1)
  const cy = round((localY + rect.height / 2) * scale, 1)
  const localCx = round((rect.width / 2) * scale, 1)
  const localCy = round((rect.height / 2) * scale, 1)

  if (mode === 'pct') {
    const pctX = round((localX / displayBounds.w) * 100, 2)
    const pctY = round((localY / displayBounds.h) * 100, 2)
    const pctW = round(rect.width / displayBounds.w * 100, 2)
    const pctH = round(rect.height / displayBounds.h * 100, 2)
    const pctCx = round(((localX + rect.width / 2) / displayBounds.w) * 100, 2)
    const pctCy = round(((localY + rect.height / 2) / displayBounds.h) * 100, 2)
    return [
      {
        label: 'Position + size',
        text: `left: ${pctX}%;\ntop: ${pctY}%;\nwidth: ${pctW}%;\nheight: ${pctH}%;`,
        hint: 'CSS percentage layout',
      },
      {
        label: 'transform-origin (doc-relative)',
        text: `transform-origin: ${pctCx}% ${pctCy}%;`,
        hint: 'Center of marquee as % of document',
      },
      {
        label: 'transform-origin (element-local)',
        text: `transform-origin: 50% 50%;`,
        hint: "Center of the marquee'd element itself",
      },
    ]
  }

  return [
    {
      label: 'Position + size',
      text: `left: ${x}px;\ntop: ${y}px;\nwidth: ${w}px;\nheight: ${h}px;`,
      hint: `CSS pixels @${unit}`,
    },
    {
      label: 'transform-origin (doc-relative)',
      text: `transform-origin: ${cx}px ${cy}px;`,
      hint: 'Center of marquee in document coords',
    },
    {
      label: 'transform-origin (element-local)',
      text: `transform-origin: ${localCx}px ${localCy}px;`,
      hint: 'Center within an element of this size',
    },
  ]
}

export function MarqueePanel({
  rect,
  displayBounds,
  is2x,
  onClear,
  onApplyCrop,
  onTakeOut,
  canTakeOut,
}: MarqueePanelProps) {
  const [unit, setUnit] = useState<'1x' | '2x'>(is2x ? '1x' : '2x')
  const [mode, setMode] = useState<'px' | 'pct'>('px')
  const [snippetIdx, setSnippetIdx] = useState(0)
  const [copied, setCopied] = useState(false)

  const snippets = snippetsFor(rect, displayBounds, unit, mode)
  // Clamp the picker index if the snippet list contracts (it doesn't today,
  // but keeps this safe under future changes).
  const idx = Math.min(snippetIdx, snippets.length - 1)
  const active = snippets[idx]

  const scale = unit === '1x' ? 0.5 : 1
  const x = round((rect.x - displayBounds.x) * scale, 1)
  const y = round((rect.y - displayBounds.y) * scale, 1)
  const w = round(rect.width * scale, 1)
  const h = round(rect.height * scale, 1)

  async function copy() {
    try {
      await navigator.clipboard.writeText(active.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="marquee-panel">
      <div className="mp-header">
        <span className="mp-title">Marquee</span>
        <div className="mp-actions">
          <button
            className="apply-take-btn"
            onClick={onTakeOut}
            disabled={!canTakeOut}
            title={
              canTakeOut
                ? 'Erase marquee from selected layer (Delete)'
                : 'Select a single layer first'
            }
          >
            Take out
          </button>
          <button
            className="apply-crop-btn"
            onClick={() => onApplyCrop(rect)}
            title="Crop the document to this marquee"
          >
            Crop
          </button>
          <button className="icon-btn" onClick={onClear} aria-label="Clear marquee">
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      <div className="mp-settings">
        {is2x && (
          <div className="seg small">
            <button className={unit === '1x' ? 'active' : ''} onClick={() => setUnit('1x')}>
              @1x
            </button>
            <button className={unit === '2x' ? 'active' : ''} onClick={() => setUnit('2x')}>
              @2x
            </button>
          </div>
        )}
        <div className="seg small">
          <button className={mode === 'px' ? 'active' : ''} onClick={() => setMode('px')}>
            px
          </button>
          <button className={mode === 'pct' ? 'active' : ''} onClick={() => setMode('pct')}>
            %
          </button>
        </div>
      </div>

      <div className="mp-dims">
        <div>
          <span className="muted">x</span> {x}
          <span className="muted">  y</span> {y}
        </div>
        <div>
          <span className="muted">w</span> {w}
          <span className="muted">  h</span> {h}
        </div>
      </div>

      <div className="mp-snippet">
        <div className="mp-snippet-head">
          <select
            className="mp-snippet-picker"
            value={idx}
            onChange={(e) => setSnippetIdx(Number(e.target.value))}
            title={active.hint}
          >
            {snippets.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="snippet-copy" onClick={copy} title={active.hint}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="snippet-text">{active.text}</pre>
      </div>
    </div>
  )
}
