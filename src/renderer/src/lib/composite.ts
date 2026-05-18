import type { DisplayBounds, LayerOffset, ParsedPsd } from '../types'
import { flattenLeaves } from './layers'

/**
 * Render the currently-visible composite of `doc` into an offscreen
 * HTMLCanvasElement at the requested scale.
 *
 * Honors the active crop (via `displayBounds`) and per-layer offsets.
 * Output dimensions are `displayBounds.{w,h} * scale`, with the crop
 * origin mapped to (0, 0) of the output.
 *
 * Caller is responsible for encoding the result (toBlob / toDataURL).
 */
export function compositeVisible(
  doc: ParsedPsd,
  visibility: Record<string, boolean>,
  offsets: Record<string, LayerOffset>,
  displayBounds: DisplayBounds,
  editedCanvases: Map<string, HTMLCanvasElement>,
  scale: number = 1,
): HTMLCanvasElement {
  const outW = Math.max(1, Math.round(displayBounds.w * scale))
  const outH = Math.max(1, Math.round(displayBounds.h * scale))
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')
  if (!ctx) return out
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Compose the scale and crop-origin translate into the context's
  // transform so each layer can be drawn at its absolute doc coord.
  if (scale !== 1) ctx.scale(scale, scale)
  if (displayBounds.x !== 0 || displayBounds.y !== 0) {
    ctx.translate(-displayBounds.x, -displayBounds.y)
  }

  // flattenLeaves returns bottom-to-top so painter's order works without
  // any sorting here.
  const leaves = flattenLeaves(doc.layers, visibility)
  for (const leaf of leaves) {
    if (!leaf.effectiveVisible) continue
    const source = editedCanvases.get(leaf.id)
    if (!source) continue
    const off = offsets[leaf.id] ?? { x: 0, y: 0 }
    ctx.drawImage(source, leaf.node.bounds.left + off.x, leaf.node.bounds.top + off.y)
  }
  return out
}
