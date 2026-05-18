export interface CanvasBBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Scan an HTMLCanvasElement for the tight bounding box of pixels whose RGBA
 * differs from the top-left pixel's RGBA by more than `tolerance` per
 * channel. Returns `null` if the canvas is uniform (no pixel differs).
 *
 * This is Photoshop's `Image > Trim → Based On: Top-Left Pixel Color`
 * semantics, applied to a flattened composite. Handles both:
 *
 * - Doc with solid-color background → top-left = bg color → bbox is the
 *   tight content rect.
 * - Doc with transparent background → top-left = transparent (0,0,0,0) →
 *   bbox is the tight non-transparent content rect.
 *
 * `tolerance` defaults to 4 to keep anti-aliased content edges (whose
 * blended pixels are close-but-not-equal to the bg) classified as content.
 */
export function scanCanvasBBoxByCornerColor(
  canvas: HTMLCanvasElement,
  tolerance = 4,
): CanvasBBox | null {
  const w = canvas.width
  const h = canvas.height
  if (w <= 0 || h <= 0) return null

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null
  }

  const refR = data[0]
  const refG = data[1]
  const refB = data[2]
  const refA = data[3]

  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * 4
    for (let x = 0; x < w; x++) {
      const off = rowOffset + x * 4
      if (
        Math.abs(data[off] - refR) > tolerance ||
        Math.abs(data[off + 1] - refG) > tolerance ||
        Math.abs(data[off + 2] - refB) > tolerance ||
        Math.abs(data[off + 3] - refA) > tolerance
      ) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return null

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  }
}
