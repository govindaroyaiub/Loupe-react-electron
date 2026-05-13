import type { LayerNode } from '../types'
import { blobUrlFor } from './blob-url'
import { flattenLeaves } from './layers'

/**
 * Decodes a layer's PNG bytes into an editable HTMLCanvasElement at its
 * intrinsic size. Returns null if the bytes don't decode (e.g. malformed PNG).
 */
function decodeLayerCanvas(bytes: Uint8Array): Promise<HTMLCanvasElement | null> {
  const url = blobUrlFor(bytes)
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(img, 0, 0)
      resolve(c)
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Decodes every leaf layer's PNG into an editable canvas and writes the
 * result into `target`. Skips layers without image data. Subsequent stroke
 * operations mutate these canvases in place.
 */
export async function warmEditableCanvases(
  layers: LayerNode[],
  target: Map<string, HTMLCanvasElement>,
): Promise<void> {
  const flat = flattenLeaves(layers, {})
  await Promise.all(
    flat.map(async (l) => {
      if (!l.node.image) return
      const canvas = await decodeLayerCanvas(l.node.image)
      if (canvas) target.set(l.id, canvas)
    }),
  )
}

/** Returns a deep pixel copy of the given canvas (for undo snapshots). */
export function snapshotCanvas(canvas: HTMLCanvasElement): ImageData | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Writes pixel data back into a canvas (for undo restore). */
export function restoreCanvas(canvas: HTMLCanvasElement, data: ImageData): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // Match canvas size to data in case the layer was somehow resized (not
  // possible today, but cheap to guard).
  if (canvas.width !== data.width) canvas.width = data.width
  if (canvas.height !== data.height) canvas.height = data.height
  ctx.putImageData(data, 0, 0)
}

/**
 * Erases a hard circular region centered at (x, y) with the given radius.
 * Coordinates are layer-local (canvas pixel space). Uses destination-out to
 * clear the alpha channel.
 */
export function eraseCircle(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
): void {
  if (radius <= 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Erases along a line segment between two points by drawing a round-capped
 * stroke. Produces a continuous swept-circle erase even for fast pointer
 * motion that would otherwise skip past pixels between mousemove events.
 */
export function eraseLineSegment(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): void {
  if (radius <= 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = radius * 2
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  ctx.restore()
}

/**
 * Erases a rectangular region in canvas-local coordinates. Used by
 * Marquee + Delete.
 */
export function eraseRect(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(x, y, width, height)
}
