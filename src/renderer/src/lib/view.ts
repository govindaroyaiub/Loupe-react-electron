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

export function screenToDoc(
  view: ViewState,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - view.offsetX) / view.scale,
    y: (screenY - view.offsetY) / view.scale,
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
