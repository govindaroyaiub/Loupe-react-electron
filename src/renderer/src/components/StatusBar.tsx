import type { MarqueeRect, Tool } from '../types'

interface StatusBarProps {
  tool: Tool
  spaceHeld: boolean
  scale: number
  mousePos: { x: number; y: number } | null
  is2x: boolean
  marquee: MarqueeRect | null
}

function fmt(n: number, digits = 0): string {
  const f = Math.pow(10, digits)
  return (Math.round(n * f) / f).toString()
}

export function StatusBar({ tool, spaceHeld, scale, mousePos, is2x, marquee }: StatusBarProps) {
  const effectiveTool = spaceHeld ? 'hand' : tool
  const toolLabel =
    effectiveTool === 'select' ? 'Select' : effectiveTool === 'marquee' ? 'Marquee' : 'Hand'

  return (
    <div className="status-bar">
      <span className="status-item">{toolLabel}</span>
      <span className="status-sep">·</span>
      <span className="status-item">{Math.round(scale * 100)}%</span>
      <span className="status-sep">·</span>
      <span className="status-item nums">
        {mousePos ? (
          is2x ? (
            <>
              <span className="muted">@2x</span> {fmt(mousePos.x)}, {fmt(mousePos.y)}
              <span className="muted">  @1x</span> {fmt(mousePos.x / 2, 1)}, {fmt(mousePos.y / 2, 1)}
            </>
          ) : (
            <>
              {fmt(mousePos.x)}, {fmt(mousePos.y)} px
            </>
          )
        ) : (
          <span className="muted">—</span>
        )}
      </span>
      {marquee && marquee.width > 0 && marquee.height > 0 && (
        <>
          <span className="status-sep">·</span>
          <span className="status-item nums">
            {is2x ? (
              <>
                <span className="muted">marquee @1x</span> {fmt(marquee.width / 2, 1)} ×{' '}
                {fmt(marquee.height / 2, 1)}
                <span className="muted">  @2x</span> {fmt(marquee.width)} × {fmt(marquee.height)}
              </>
            ) : (
              <>
                <span className="muted">marquee</span> {fmt(marquee.width)} × {fmt(marquee.height)}
              </>
            )}
          </span>
        </>
      )}
    </div>
  )
}
