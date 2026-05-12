import { useState } from 'react'
import type { MarqueeRect } from '../types'

interface MarqueePanelProps {
  rect: MarqueeRect
  docWidth: number
  docHeight: number
  is2x: boolean
  onClear: () => void
  onSaveAsRule: (rect: MarqueeRect) => void
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
  docWidth: number,
  docHeight: number,
  unit: '1x' | '2x',
  mode: 'px' | 'pct',
): Snippet[] {
  const scale = unit === '1x' ? 0.5 : 1
  const x = round(rect.x * scale, 1)
  const y = round(rect.y * scale, 1)
  const w = round(rect.width * scale, 1)
  const h = round(rect.height * scale, 1)
  const cx = round((rect.x + rect.width / 2) * scale, 1)
  const cy = round((rect.y + rect.height / 2) * scale, 1)
  const localCx = round((rect.width / 2) * scale, 1)
  const localCy = round((rect.height / 2) * scale, 1)

  if (mode === 'pct') {
    const pctX = round((rect.x / docWidth) * 100, 2)
    const pctY = round((rect.y / docHeight) * 100, 2)
    const pctW = round((rect.width / docWidth) * 100, 2)
    const pctH = round((rect.height / docHeight) * 100, 2)
    const pctCx = round(((rect.x + rect.width / 2) / docWidth) * 100, 2)
    const pctCy = round(((rect.y + rect.height / 2) / docHeight) * 100, 2)
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
  docWidth,
  docHeight,
  is2x,
  onClear,
  onSaveAsRule,
}: MarqueePanelProps) {
  const [unit, setUnit] = useState<'1x' | '2x'>(is2x ? '1x' : '2x')
  const [mode, setMode] = useState<'px' | 'pct'>('px')
  const [copied, setCopied] = useState<string | null>(null)

  const snippets = snippetsFor(rect, docWidth, docHeight, unit, mode)

  const scale = unit === '1x' ? 0.5 : 1
  const x = round(rect.x * scale, 1)
  const y = round(rect.y * scale, 1)
  const w = round(rect.width * scale, 1)
  const h = round(rect.height * scale, 1)

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="marquee-panel">
      <div className="mp-header">
        <span className="mp-title">Marquee</span>
        <div className="seg small">
          {is2x && (
            <>
              <button className={unit === '1x' ? 'active' : ''} onClick={() => setUnit('1x')}>
                @1x
              </button>
              <button className={unit === '2x' ? 'active' : ''} onClick={() => setUnit('2x')}>
                @2x
              </button>
            </>
          )}
          <button className={mode === 'px' ? 'active' : ''} onClick={() => setMode('px')}>
            px
          </button>
          <button className={mode === 'pct' ? 'active' : ''} onClick={() => setMode('pct')}>
            %
          </button>
        </div>
        <button
          className="save-rule-btn"
          onClick={() => onSaveAsRule(rect)}
          title="Save as Rule"
        >
          + Rule
        </button>
        <button className="icon-btn" onClick={onClear} aria-label="Clear marquee">
          ✕
        </button>
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

      <div className="mp-snippets">
        {snippets.map((s) => (
          <div key={s.label} className="snippet">
            <div className="snippet-head">
              <span className="snippet-label">{s.label}</span>
              <button
                className="snippet-copy"
                onClick={() => copy(s.label, s.text)}
                title={s.hint}
              >
                {copied === s.label ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="snippet-text">{s.text}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}
