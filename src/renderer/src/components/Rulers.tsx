import { useMemo } from 'react'
import type { ViewState } from '../lib/view'
import type { DisplayBounds, GuideOrientation } from '../types'

interface RulersProps {
  view: ViewState
  viewportWidth: number
  viewportHeight: number
  /**
   * Visible document bounds. Tick labels and the shaded band reflect this
   * region (full doc when no crop, the cropRect when one is active). Tick
   * values are displayed relative to `displayBounds.{x,y}` so the visible
   * region always reads from 0.
   */
  displayBounds: DisplayBounds
  is2x: boolean
  mousePos: { x: number; y: number } | null
  onGuideDragStart: (orientation: GuideOrientation, e: React.MouseEvent) => void
}

const RULER_THICKNESS = 24

function pickStep(scale: number): number {
  const targetPx = 90
  const targetDoc = targetPx / scale
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  for (const s of niceSteps) {
    if (s >= targetDoc) return s
  }
  return niceSteps[niceSteps.length - 1]
}

interface Tick {
  pos: number
  doc: number
}

/**
 * Build ticks at multiples of `step` within the document, returning their
 * positions in the SVG's own coordinate space.
 *
 * The ruler SVG's internal x=0 corresponds to viewport-x = RULER_THICKNESS,
 * which is also where the stage container's x=0 sits. That means `docZeroSvg`
 * (the document origin's position) is simply `view.offsetX` — no rebasing.
 */
function ticksWithinDoc(
  svgLength: number,
  docZeroSvg: number,
  docMaxSvg: number,
  scale: number,
  step: number,
): Tick[] {
  const visibleStart = Math.max(0, docZeroSvg)
  const visibleEnd = Math.min(svgLength, docMaxSvg)
  if (visibleEnd <= visibleStart) return []
  const docStart = (visibleStart - docZeroSvg) / scale
  const docEnd = (visibleEnd - docZeroSvg) / scale
  const firstDoc = Math.ceil(docStart / step) * step
  const out: Tick[] = []
  for (let d = firstDoc; d <= docEnd; d += step) {
    if (d <= 0) continue
    const screen = d * scale + docZeroSvg
    if (screen >= visibleStart && screen <= visibleEnd) {
      out.push({ pos: screen, doc: d })
    }
  }
  return out
}

export function Rulers({
  view,
  viewportWidth,
  viewportHeight,
  displayBounds,
  is2x,
  mousePos,
  onGuideDragStart,
}: RulersProps) {
  const step = useMemo(() => pickStep(view.scale), [view.scale])

  // Positions in the ruler SVGs' own coordinate space (which matches
  // stage-container coords). Because the Stage is translated by
  // `-displayBounds.{x,y} * scale`, the *visible* doc origin (displayBounds.x,
  // .y) sits at screen view.offsetX/Y. So docZero* lands at view.offset*.
  const docZeroX = view.offsetX
  const docMaxX = view.offsetX + displayBounds.w * view.scale
  const docZeroY = view.offsetY
  const docMaxY = view.offsetY + displayBounds.h * view.scale

  const topSvgLength = Math.max(0, viewportWidth - RULER_THICKNESS)
  const leftSvgLength = Math.max(0, viewportHeight - RULER_THICKNESS)

  const hTicks = useMemo(
    () => ticksWithinDoc(topSvgLength, docZeroX, docMaxX, view.scale, step),
    [topSvgLength, docZeroX, docMaxX, view.scale, step],
  )
  const vTicks = useMemo(
    () => ticksWithinDoc(leftSvgLength, docZeroY, docMaxY, view.scale, step),
    [leftSvgLength, docZeroY, docMaxY, view.scale, step],
  )

  // Mouse position from Canvas is in absolute doc coords; subtract the
  // displayBounds origin so the indicator aligns with the (cropped) visible
  // region on the rulers.
  const mouseSvgX = mousePos ? (mousePos.x - displayBounds.x) * view.scale + view.offsetX : null
  const mouseSvgY = mousePos ? (mousePos.y - displayBounds.y) * view.scale + view.offsetY : null

  // Midpoint of the visible doc — a small accent-colored triangle pointing
  // toward the canvas. Useful for centering content visually.
  const midDocX = displayBounds.w / 2
  const midDocY = displayBounds.h / 2
  const midSvgX = midDocX * view.scale + view.offsetX
  const midSvgY = midDocY * view.scale + view.offsetY
  const midShownX = midSvgX >= 0 && midSvgX <= topSvgLength && displayBounds.w > 0
  const midShownY = midSvgY >= 0 && midSvgY <= leftSvgLength && displayBounds.h > 0

  return (
    <>
      <div
        className="ruler-corner"
        style={{ width: RULER_THICKNESS, height: RULER_THICKNESS }}
      />

      {/* Top ruler — drag down to drop a horizontal guide */}
      <svg
        className="ruler ruler-top"
        width={topSvgLength}
        height={RULER_THICKNESS}
        style={{ left: RULER_THICKNESS, top: 0, cursor: 'ns-resize' }}
        onMouseDown={(e) => onGuideDragStart('horizontal', e)}
      >
        <rect width="100%" height="100%" fill="var(--bg-toolbar)" />

        {/* Document extent shaded band */}
        <rect
          x={Math.max(0, docZeroX)}
          y={0}
          width={Math.max(0, Math.min(topSvgLength, docMaxX) - Math.max(0, docZeroX))}
          height={RULER_THICKNESS}
          fill="rgba(74,163,255,0.08)"
        />

        {/* Tick marks inside doc extent */}
        {hTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={t.pos}
              x2={t.pos}
              y1={RULER_THICKNESS - 5}
              y2={RULER_THICKNESS}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
            />
            <text
              x={t.pos + 3}
              y={RULER_THICKNESS - 7}
              fill="rgba(255,255,255,0.55)"
              fontSize="9.5"
              fontFamily="system-ui, sans-serif"
            >
              {t.doc}
            </text>
          </g>
        ))}

        {/* Document edge markers */}
        {[docZeroX, docMaxX].map((x, i) => {
          if (x < 0 || x > topSvgLength) return null
          return (
            <line
              key={`bound-${i}`}
              x1={x}
              x2={x}
              y1={0}
              y2={RULER_THICKNESS}
              stroke="rgba(74,163,255,0.55)"
              strokeWidth={1}
            />
          )
        })}

        {/* Midpoint marker — small triangle at half the visible width. */}
        {midShownX && (
          <g>
            <line
              x1={midSvgX}
              x2={midSvgX}
              y1={6}
              y2={RULER_THICKNESS}
              stroke="rgba(74, 163, 255, 0.55)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <polygon
              points={`${midSvgX - 4},0 ${midSvgX + 4},0 ${midSvgX},6`}
              fill="var(--accent)"
            >
              <title>
                {`Midpoint ${midDocX}px${
                  is2x ? ` @2x · ${midDocX / 2} @1x` : ''
                }`}
              </title>
            </polygon>
          </g>
        )}

        {/* Mouse indicator */}
        {mouseSvgX !== null && mouseSvgX >= 0 && mouseSvgX <= topSvgLength && (
          <line
            x1={mouseSvgX}
            x2={mouseSvgX}
            y1={0}
            y2={RULER_THICKNESS}
            stroke="#ffd84a"
            strokeWidth={1}
          />
        )}
      </svg>

      {/* Left ruler — drag right to drop a vertical guide */}
      <svg
        className="ruler ruler-left"
        width={RULER_THICKNESS}
        height={leftSvgLength}
        style={{ left: 0, top: RULER_THICKNESS, cursor: 'ew-resize' }}
        onMouseDown={(e) => onGuideDragStart('vertical', e)}
      >
        <rect width="100%" height="100%" fill="var(--bg-toolbar)" />

        <rect
          x={0}
          y={Math.max(0, docZeroY)}
          width={RULER_THICKNESS}
          height={Math.max(0, Math.min(leftSvgLength, docMaxY) - Math.max(0, docZeroY))}
          fill="rgba(74,163,255,0.08)"
        />

        {vTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={RULER_THICKNESS - 5}
              x2={RULER_THICKNESS}
              y1={t.pos}
              y2={t.pos}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
            />
            <text
              x={RULER_THICKNESS - 7}
              y={t.pos - 3}
              fill="rgba(255,255,255,0.55)"
              fontSize="9.5"
              fontFamily="system-ui, sans-serif"
              textAnchor="end"
              transform={`rotate(-90 ${RULER_THICKNESS - 7} ${t.pos - 3})`}
            >
              {t.doc}
            </text>
          </g>
        ))}

        {[docZeroY, docMaxY].map((y, i) => {
          if (y < 0 || y > leftSvgLength) return null
          return (
            <line
              key={`bound-${i}`}
              x1={0}
              x2={RULER_THICKNESS}
              y1={y}
              y2={y}
              stroke="rgba(74,163,255,0.55)"
              strokeWidth={1}
            />
          )
        })}

        {/* Midpoint marker — small triangle at half the visible height. */}
        {midShownY && (
          <g>
            <line
              x1={6}
              x2={RULER_THICKNESS}
              y1={midSvgY}
              y2={midSvgY}
              stroke="rgba(74, 163, 255, 0.55)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <polygon
              points={`0,${midSvgY - 4} 0,${midSvgY + 4} 6,${midSvgY}`}
              fill="var(--accent)"
            >
              <title>
                {`Midpoint ${midDocY}px${
                  is2x ? ` @2x · ${midDocY / 2} @1x` : ''
                }`}
              </title>
            </polygon>
          </g>
        )}

        {mouseSvgY !== null && mouseSvgY >= 0 && mouseSvgY <= leftSvgLength && (
          <line
            x1={0}
            x2={RULER_THICKNESS}
            y1={mouseSvgY}
            y2={mouseSvgY}
            stroke="#ffd84a"
            strokeWidth={1}
          />
        )}
      </svg>
    </>
  )
}

export { RULER_THICKNESS }
