import type { DisplayBounds, MarqueeRect, Tool } from '../types'

interface StatusBarProps {
  tool: Tool
  spaceHeld: boolean
  scale: number
  /** Mouse position in absolute doc coords (may be outside displayBounds). */
  mousePos: { x: number; y: number } | null
  is2x: boolean
  marquee: MarqueeRect | null
  /** Subtracted from mousePos before display so cropped mode reads from 0. */
  displayBounds: DisplayBounds
}

function fmt(n: number, digits = 0): string {
  const f = Math.pow(10, digits)
  return (Math.round(n * f) / f).toString()
}

export function StatusBar({
  tool,
  spaceHeld,
  scale,
  mousePos,
  is2x,
  marquee,
  displayBounds,
}: StatusBarProps) {
  const effectiveTool = spaceHeld ? 'hand' : tool
  const toolLabel =
    effectiveTool === 'select' ? 'Select' : effectiveTool === 'marquee' ? 'Marquee' : 'Hand'

  // Shift mouse position into the visible doc space — equals the absolute
  // doc-coords when no crop is active.
  const localMouseX = mousePos ? mousePos.x - displayBounds.x : null
  const localMouseY = mousePos ? mousePos.y - displayBounds.y : null

  return (
    <div className="status-bar">
      <span className="status-item">{toolLabel}</span>
      <span className="status-sep">·</span>
      <span className="status-item">{Math.round(scale * 100)}%</span>
      <span className="status-sep">·</span>
      {/* Width is pre-reserved so the row doesn't jump when the user
         moves the cursor onto / off the canvas. */}
      <span className="status-item nums status-mouse">
        {localMouseX !== null && localMouseY !== null ? (
          is2x ? (
            <>
              <span className="muted">@2x</span> {fmt(localMouseX)}, {fmt(localMouseY)}
              <span className="muted">  @1x</span> {fmt(localMouseX / 2, 1)},{' '}
              {fmt(localMouseY / 2, 1)}
            </>
          ) : (
            <>
              {fmt(localMouseX)}, {fmt(localMouseY)} px
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
