import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Line } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  DraggingGuide,
  GridConfig,
  Guide,
  MarqueeRect,
  ParsedPsd,
  Tool,
} from '../types'
import { blobUrlFor } from '../lib/blob-url'
import { findLayerAt, flattenLeaves } from '../lib/layers'
import { screenToDoc, zoomAt, type ViewState } from '../lib/view'

const CLICK_THRESHOLD_PX = 3

interface CanvasProps {
  doc: ParsedPsd
  visibility: Record<string, boolean>
  selection: Set<string>
  view: ViewState
  onViewChange: (next: ViewState) => void
  tool: Tool
  spaceHeld: boolean
  marquee: MarqueeRect | null
  onMarqueeChange: (next: MarqueeRect | null, finalized: boolean) => void
  grid: GridConfig
  guides: Guide[]
  draggingGuide: DraggingGuide | null
  onGuideMouseDown: (guideId: string) => void
  onCanvasSelectLayer: (layerId: string) => void
  viewportWidth: number
  viewportHeight: number
  onMousePos: (pos: { x: number; y: number } | null) => void
}

const GUIDE_HIT_TOLERANCE_PX = 5

function useImageFromBytes(bytes: Uint8Array | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!bytes) {
      setImage(null)
      return
    }
    const url = blobUrlFor(bytes)
    if (!url) return
    const img = new window.Image()
    img.src = url
    img.onload = () => setImage(img)
    return () => {
      img.onload = null
    }
  }, [bytes])
  return image
}

function LeafLayer({
  bytes,
  x,
  y,
  visible,
}: {
  bytes: Uint8Array
  x: number
  y: number
  visible: boolean
}) {
  const img = useImageFromBytes(bytes)
  if (!img || !visible) return null
  return <KonvaImage image={img} x={x} y={y} listening={false} />
}

function buildGridLines(
  docW: number,
  docH: number,
  spacing: number,
): { points: number[]; key: string }[] {
  if (spacing <= 0 || spacing > Math.max(docW, docH)) return []
  const lines: { points: number[]; key: string }[] = []
  for (let x = spacing; x < docW; x += spacing) {
    lines.push({ points: [x, 0, x, docH], key: `v${x}` })
  }
  for (let y = spacing; y < docH; y += spacing) {
    lines.push({ points: [0, y, docW, y], key: `h${y}` })
  }
  return lines
}

export function Canvas({
  doc,
  visibility,
  selection,
  view,
  onViewChange,
  tool,
  spaceHeld,
  marquee,
  onMarqueeChange,
  grid,
  guides,
  draggingGuide,
  onGuideMouseDown,
  onCanvasSelectLayer,
  viewportWidth,
  viewportHeight,
  onMousePos,
}: CanvasProps) {
  const stageRef = useRef(null)
  const dragStateRef = useRef<
    | { kind: 'pan'; startX: number; startY: number; origOffsetX: number; origOffsetY: number }
    | {
        kind: 'marquee'
        startScreenX: number
        startScreenY: number
        startDocX: number
        startDocY: number
        maxMoveSq: number
      }
    | null
  >(null)

  const leaves = useMemo(() => flattenLeaves(doc.layers, visibility), [doc.layers, visibility])

  const selectedBoxes = useMemo(() => {
    if (selection.size === 0) return []
    return leaves
      .filter((l) => selection.has(l.id))
      .map((l) => {
        const b = l.node.bounds
        return {
          id: l.id,
          x: b.left,
          y: b.top,
          width: Math.max(1, b.right - b.left),
          height: Math.max(1, b.bottom - b.top),
        }
      })
  }, [selection, leaves])

  const gridLines = useMemo(
    () => (grid.enabled ? buildGridLines(doc.width, doc.height, grid.spacing) : []),
    [grid.enabled, grid.spacing, doc.width, doc.height],
  )

  const effectiveTool: Tool = spaceHeld ? 'hand' : tool

  function handleWheel(e: KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const factor = e.evt.deltaY > 0 ? 1 / 1.1 : 1.1
    onViewChange(zoomAt(view, pointer.x, pointer.y, factor))
  }

  function handleMouseDown(e: KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage()
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    // Cmd (Mac) / Alt (Win) + click: solo the topmost layer under cursor.
    if (e.evt.metaKey || e.evt.altKey) {
      const docPosForSelect = screenToDoc(view, pointer.x, pointer.y)
      const inDoc =
        docPosForSelect.x >= 0 &&
        docPosForSelect.x <= doc.width &&
        docPosForSelect.y >= 0 &&
        docPosForSelect.y <= doc.height
      if (inDoc) {
        const hit = findLayerAt(doc.layers, visibility, docPosForSelect.x, docPosForSelect.y)
        if (hit) onCanvasSelectLayer(hit.id)
      }
      return
    }

    // Guide grab takes priority over tool action.
    const docPosForHit = screenToDoc(view, pointer.x, pointer.y)
    const tolDoc = GUIDE_HIT_TOLERANCE_PX / view.scale
    for (const g of guides) {
      const inDocBounds =
        docPosForHit.x >= 0 &&
        docPosForHit.x <= doc.width &&
        docPosForHit.y >= 0 &&
        docPosForHit.y <= doc.height
      if (!inDocBounds) continue
      const distance =
        g.orientation === 'vertical'
          ? Math.abs(docPosForHit.x - g.pos)
          : Math.abs(docPosForHit.y - g.pos)
      if (distance <= tolDoc) {
        onGuideMouseDown(g.id)
        return
      }
    }

    if (effectiveTool === 'hand') {
      dragStateRef.current = {
        kind: 'pan',
        startX: pointer.x,
        startY: pointer.y,
        origOffsetX: view.offsetX,
        origOffsetY: view.offsetY,
      }
    } else if (effectiveTool === 'marquee') {
      const docPos = screenToDoc(view, pointer.x, pointer.y)
      // Clamp start to canvas bounds — drags from outside still produce a sensible
      // in-canvas marquee as the cursor enters the document.
      const startDocX = Math.min(Math.max(docPos.x, 0), doc.width)
      const startDocY = Math.min(Math.max(docPos.y, 0), doc.height)
      dragStateRef.current = {
        kind: 'marquee',
        startScreenX: pointer.x,
        startScreenY: pointer.y,
        startDocX,
        startDocY,
        maxMoveSq: 0,
      }
      onMarqueeChange({ x: startDocX, y: startDocY, width: 0, height: 0 }, false)
    }
  }

  function handleMouseMove(e: KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage()
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) {
      onMousePos(null)
      return
    }
    const docPos = screenToDoc(view, pointer.x, pointer.y)
    onMousePos(docPos)

    // Update hover-near-guide cursor when not dragging.
    if (!dragStateRef.current) {
      const tolDoc = GUIDE_HIT_TOLERANCE_PX / view.scale
      const inDocBounds =
        docPos.x >= 0 && docPos.x <= doc.width && docPos.y >= 0 && docPos.y <= doc.height
      let nearest: 'vertical' | 'horizontal' | null = null
      if (inDocBounds) {
        for (const g of guides) {
          const d =
            g.orientation === 'vertical'
              ? Math.abs(docPos.x - g.pos)
              : Math.abs(docPos.y - g.pos)
          if (d <= tolDoc) {
            nearest = g.orientation
            break
          }
        }
      }
      if (nearest !== hoverGuide) setHoverGuide(nearest)
    }

    const drag = dragStateRef.current
    if (!drag) return

    if (drag.kind === 'pan') {
      onViewChange({
        scale: view.scale,
        offsetX: drag.origOffsetX + (pointer.x - drag.startX),
        offsetY: drag.origOffsetY + (pointer.y - drag.startY),
      })
    } else if (drag.kind === 'marquee') {
      const dx = pointer.x - drag.startScreenX
      const dy = pointer.y - drag.startScreenY
      drag.maxMoveSq = Math.max(drag.maxMoveSq, dx * dx + dy * dy)
      // Always paint the marquee from the very first pixel of movement.
      const clampedX = Math.min(Math.max(docPos.x, 0), doc.width)
      const clampedY = Math.min(Math.max(docPos.y, 0), doc.height)
      const x = Math.min(drag.startDocX, clampedX)
      const y = Math.min(drag.startDocY, clampedY)
      const width = Math.abs(clampedX - drag.startDocX)
      const height = Math.abs(clampedY - drag.startDocY)
      onMarqueeChange({ x, y, width, height }, false)
    }
  }

  function handleMouseUp() {
    const drag = dragStateRef.current
    dragStateRef.current = null
    if (!drag || drag.kind !== 'marquee') return

    const wasDrag = drag.maxMoveSq > CLICK_THRESHOLD_PX * CLICK_THRESHOLD_PX

    if (wasDrag) {
      // Finalize the drag rect (allow 0 along one axis — that's a valid axis ruler).
      if (!marquee || (marquee.width < 1 && marquee.height < 1)) {
        onMarqueeChange(null, true)
      } else {
        onMarqueeChange(marquee, true)
      }
      return
    }

    // No-drag click → marquee tool only acts on drag. Clear any existing rect.
    onMarqueeChange(null, true)
  }

  function handleMouseLeave() {
    onMousePos(null)
  }

  const [hoverGuide, setHoverGuide] = useState<'vertical' | 'horizontal' | null>(null)

  const [checkerImage, setCheckerImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 16
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#d6d6d6'
    ctx.fillRect(0, 0, 16, 16)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 8, 8)
    ctx.fillRect(8, 8, 8, 8)
    const img = new window.Image()
    img.onload = () => setCheckerImage(img)
    img.src = c.toDataURL()
  }, [])

  const cursor = hoverGuide
    ? hoverGuide === 'vertical'
      ? 'ew-resize'
      : 'ns-resize'
    : effectiveTool === 'hand'
      ? dragStateRef.current?.kind === 'pan'
        ? 'grabbing'
        : 'grab'
      : effectiveTool === 'marquee'
        ? 'crosshair'
        : 'default'

  return (
    <Stage
      ref={stageRef}
      width={viewportWidth}
      height={viewportHeight}
      x={view.offsetX}
      y={view.offsetY}
      scaleX={view.scale}
      scaleY={view.scale}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{ cursor }}
    >
      <Layer listening={false}>
        <Rect
          x={0}
          y={0}
          width={doc.width}
          height={doc.height}
          fillPatternImage={checkerImage ?? undefined}
          fillPatternRepeat="repeat"
          fillPatternScaleX={1 / view.scale}
          fillPatternScaleY={1 / view.scale}
          fill={checkerImage ? undefined : '#ffffff'}
          shadowBlur={28 / view.scale}
          shadowColor="rgba(0,0,0,0.55)"
          shadowOffsetY={4 / view.scale}
        />
      </Layer>
      <Layer
        listening={false}
        clip={{ x: 0, y: 0, width: doc.width, height: doc.height }}
      >
        {leaves.map((leaf) =>
          leaf.node.image ? (
            <LeafLayer
              key={leaf.id}
              bytes={leaf.node.image}
              x={leaf.node.bounds.left}
              y={leaf.node.bounds.top}
              visible={leaf.effectiveVisible}
            />
          ) : null,
        )}
      </Layer>
      <Layer listening={false}>
        <Rect
          x={0}
          y={0}
          width={doc.width}
          height={doc.height}
          stroke="rgba(255,255,255,0.45)"
          strokeWidth={1 / view.scale}
          fillEnabled={false}
          listening={false}
        />
      </Layer>
      {gridLines.length > 0 && (
        <Layer listening={false}>
          {gridLines.map((g) => (
            <Line
              key={g.key}
              points={g.points}
              stroke="rgba(74, 163, 255, 0.18)"
              strokeWidth={1 / view.scale}
            />
          ))}
          <Rect
            x={0}
            y={0}
            width={doc.width}
            height={doc.height}
            stroke="rgba(74, 163, 255, 0.28)"
            strokeWidth={1 / view.scale}
            fillEnabled={false}
          />
        </Layer>
      )}
      {effectiveTool !== 'marquee' && selectedBoxes.length > 0 && (
        <Layer listening={false}>
          {selectedBoxes.map((box) => (
            <Rect
              key={box.id}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              stroke="#4aa3ff"
              strokeWidth={2 / view.scale}
              dash={[6 / view.scale, 4 / view.scale]}
              listening={false}
            />
          ))}
        </Layer>
      )}
      {effectiveTool === 'marquee' && marquee && (marquee.width > 0 || marquee.height > 0) && (
        <Layer listening={false}>
          <Rect
            x={marquee.x}
            y={marquee.y}
            width={marquee.width}
            height={marquee.height}
            stroke="#ffd84a"
            strokeWidth={1.5 / view.scale}
            dash={[5 / view.scale, 3 / view.scale]}
            fill="rgba(255, 216, 74, 0.08)"
          />
        </Layer>
      )}
      {(guides.length > 0 || draggingGuide) && (
        <Layer listening={false}>
          {guides.map((g) =>
            g.orientation === 'vertical' ? (
              <Line
                key={g.id}
                points={[g.pos, 0, g.pos, doc.height]}
                stroke="#00c2ff"
                strokeWidth={1 / view.scale}
              />
            ) : (
              <Line
                key={g.id}
                points={[0, g.pos, doc.width, g.pos]}
                stroke="#00c2ff"
                strokeWidth={1 / view.scale}
              />
            ),
          )}
          {draggingGuide &&
            (draggingGuide.orientation === 'vertical' ? (
              <Line
                points={[draggingGuide.pos, 0, draggingGuide.pos, doc.height]}
                stroke={draggingGuide.overRuler ? '#ff6b6b' : '#00c2ff'}
                strokeWidth={1 / view.scale}
                dash={[6 / view.scale, 4 / view.scale]}
                opacity={draggingGuide.overRuler ? 0.7 : 1}
              />
            ) : (
              <Line
                points={[0, draggingGuide.pos, doc.width, draggingGuide.pos]}
                stroke={draggingGuide.overRuler ? '#ff6b6b' : '#00c2ff'}
                strokeWidth={1 / view.scale}
                dash={[6 / view.scale, 4 / view.scale]}
                opacity={draggingGuide.overRuler ? 0.7 : 1}
              />
            ))}
        </Layer>
      )}
    </Stage>
  )
}
