export interface ViewState {
  scale: number
  offsetX: number
  offsetY: number
}

export const MIN_SCALE = 0.05
export const MAX_SCALE = 8

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

export function fitView(
  docWidth: number,
  docHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 48,
): ViewState {
  const sx = (viewportWidth - padding) / docWidth
  const sy = (viewportHeight - padding) / docHeight
  const scale = Math.min(1, sx, sy) || 1
  return {
    scale,
    offsetX: (viewportWidth - docWidth * scale) / 2,
    offsetY: (viewportHeight - docHeight * scale) / 2,
  }
}

export function zoomAt(
  view: ViewState,
  screenX: number,
  screenY: number,
  factor: number,
): ViewState {
  const newScale = clampScale(view.scale * factor)
  const actualFactor = newScale / view.scale
  return {
    scale: newScale,
    offsetX: screenX - (screenX - view.offsetX) * actualFactor,
    offsetY: screenY - (screenY - view.offsetY) * actualFactor,
  }
}

export function setZoom(
  view: ViewState,
  newScale: number,
  screenX: number,
  screenY: number,
): ViewState {
  return zoomAt(view, screenX, screenY, clampScale(newScale) / view.scale)
}

/**
 * Convert a screen-space point (in CSS pixels, relative to the stage
 * container) to an absolute document coordinate. When a crop is active, the
 * Konva Stage is translated by `-(cropOffsetX, cropOffsetY) * scale` so the
 * crop origin lines up with `view.offset`. To keep this function's output in
 * absolute doc-coords regardless, callers pass `displayBounds.{x,y}` (which
 * is `cropRect.{x,y}` when cropped, or `(0,0)` when not).
 */
export function screenToDoc(
  view: ViewState,
  screenX: number,
  screenY: number,
  cropOffsetX = 0,
  cropOffsetY = 0,
): { x: number; y: number } {
  return {
    x: (screenX - view.offsetX) / view.scale + cropOffsetX,
    y: (screenY - view.offsetY) / view.scale + cropOffsetY,
  }
}

export function docToScreen(
  view: ViewState,
  docX: number,
  docY: number,
): { x: number; y: number } {
  return {
    x: docX * view.scale + view.offsetX,
    y: docY * view.scale + view.offsetY,
  }
}
