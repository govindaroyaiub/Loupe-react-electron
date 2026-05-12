import { useMemo, useState } from 'react'
import type { Guide } from '../types'

interface GuidesPanelProps {
  guides: Guide[]
  docWidth: number
  docHeight: number
  is2x: boolean
  onClear: () => void
  onSaveIntersectionAsRule: (point: { x: number; y: number }) => void
}

function round(n: number, digits = 1): number {
  const f = Math.pow(10, digits)
  return Math.round(n * f) / f
}

export function GuidesPanel({
  guides,
  docWidth,
  docHeight,
  is2x,
  onClear,
  onSaveIntersectionAsRule,
}: GuidesPanelProps) {
  const [unit, setUnit] = useState<'1x' | '2x'>(is2x ? '1x' : '2x')
  const [mode, setMode] = useState<'px' | 'pct'>('px')
  const [copied, setCopied] = useState<string | null>(null)

  const verticals = useMemo(() => guides.filter((g) => g.orientation === 'vertical'), [guides])
  const horizontals = useMemo(() => guides.filter((g) => g.orientation === 'horizontal'), [guides])

  const intersection = useMemo(() => {
    if (verticals.length === 1 && horizontals.length === 1) {
      return { x: verticals[0].pos, y: horizontals[0].pos }
    }
    return null
  }, [verticals, horizontals])

  const scale = unit === '1x' ? 0.5 : 1

  function fmtPos(pos: number, dim: 'x' | 'y'): string {
    if (mode === 'pct') {
      const total = dim === 'x' ? docWidth : docHeight
      return `${round((pos / total) * 100, 2)}%`
    }
    return `${round(pos * scale, 1)}px`
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200)
    } catch {
      /* ignore */
    }
  }

  let intersectionSnippet: { transformOrigin: string } | null = null
  if (intersection) {
    if (mode === 'pct') {
      const px = round((intersection.x / docWidth) * 100, 2)
      const py = round((intersection.y / docHeight) * 100, 2)
      intersectionSnippet = { transformOrigin: `transform-origin: ${px}% ${py}%;` }
    } else {
      const px = round(intersection.x * scale, 1)
      const py = round(intersection.y * scale, 1)
      intersectionSnippet = { transformOrigin: `transform-origin: ${px}px ${py}px;` }
    }
  }

  return (
    <div className="guides-panel">
      <div className="mp-header">
        <span className="mp-title">Guides</span>
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
        {intersection && (
          <button
            className="save-rule-btn"
            onClick={() => onSaveIntersectionAsRule(intersection)}
            title="Save intersection as Rule"
          >
            + Rule
          </button>
        )}
        <button className="icon-btn" onClick={onClear} aria-label="Clear all guides" title="Clear all">
          ✕
        </button>
      </div>

      <div className="guides-list">
        {verticals.length > 0 && (
          <div className="guides-section">
            <span className="muted">Vertical (X)</span>
            <div className="guides-values">
              {verticals.map((g) => (
                <span key={g.id} className="guides-value">
                  {fmtPos(g.pos, 'x')}
                </span>
              ))}
            </div>
          </div>
        )}
        {horizontals.length > 0 && (
          <div className="guides-section">
            <span className="muted">Horizontal (Y)</span>
            <div className="guides-values">
              {horizontals.map((g) => (
                <span key={g.id} className="guides-value">
                  {fmtPos(g.pos, 'y')}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {intersection && intersectionSnippet && (
        <div className="guides-intersection">
          <div className="intersection-label">
            <span className="muted">Intersection</span>
            <span className="intersection-value">
              {fmtPos(intersection.x, 'x')}, {fmtPos(intersection.y, 'y')}
            </span>
          </div>
          <div className="snippet">
            <div className="snippet-head">
              <span className="snippet-label">transform-origin</span>
              <button
                className="snippet-copy"
                onClick={() => copy('to', intersectionSnippet!.transformOrigin)}
              >
                {copied === 'to' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="snippet-text">{intersectionSnippet.transformOrigin}</pre>
          </div>
        </div>
      )}

      <div className="guides-hint">Drag from rulers · drag a guide back to the ruler to delete</div>
    </div>
  )
}
