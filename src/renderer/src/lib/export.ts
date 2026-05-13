import type { LayerNode } from '../types'
import { blobUrlFor } from './blob-url'

export type ExportFormat = 'png' | 'jpeg'
export type BackgroundFill = 'transparent' | 'white' | 'black'

export interface ExportOptions {
  format: ExportFormat
  scale: number
  background: BackgroundFill
  jpegQuality: number
}

export interface ExportTarget {
  layer: LayerNode
  destPath: string
}

export interface ExportPlanItem {
  layer: LayerNode
  filename: string
  width: number
  height: number
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 80) || 'layer'
}

export function planExports(
  layers: LayerNode[],
  opts: ExportOptions,
  baseName: string,
): ExportPlanItem[] {
  const ext = opts.format === 'png' ? 'png' : 'jpg'
  const items: ExportPlanItem[] = []
  for (const layer of layers) {
    const w = Math.max(1, Math.round((layer.bounds.right - layer.bounds.left) * opts.scale))
    const h = Math.max(1, Math.round((layer.bounds.bottom - layer.bounds.top) * opts.scale))
    items.push({
      layer,
      filename: `${baseName}__${safeName(layer.name)}.${ext}`,
      width: w,
      height: h,
    })
  }
  return items
}

function loadImage(bytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = blobUrlFor(bytes)
    if (!url) {
      reject(new Error('No image bytes'))
      return
    }
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to decode layer image'))
    img.src = url
  })
}

function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buf) => new Uint8Array(buf))
}

export async function renderLayerToBytes(
  layer: LayerNode,
  opts: ExportOptions,
  /**
   * Live editable canvas with the user's in-session eraser edits applied.
   * When provided, this is used as the source instead of the layer's
   * original PNG bytes, so exports reflect in-app erasures.
   */
  editedCanvas?: HTMLCanvasElement,
): Promise<Uint8Array> {
  let sourceWidth: number
  let sourceHeight: number
  let drawSource: CanvasImageSource

  if (editedCanvas) {
    sourceWidth = editedCanvas.width
    sourceHeight = editedCanvas.height
    drawSource = editedCanvas
  } else {
    if (!layer.image) {
      throw new Error(`Layer "${layer.name}" has no rasterized data.`)
    }
    const img = await loadImage(layer.image)
    sourceWidth = img.width
    sourceHeight = img.height
    drawSource = img
  }

  const w = Math.max(1, Math.round(sourceWidth * opts.scale))
  const h = Math.max(1, Math.round(sourceHeight * opts.scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D context')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (opts.background !== 'transparent') {
    ctx.fillStyle = opts.background === 'white' ? '#ffffff' : '#000000'
    ctx.fillRect(0, 0, w, h)
  }

  ctx.drawImage(drawSource, 0, 0, w, h)

  const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg'
  const quality = opts.format === 'jpeg' ? opts.jpegQuality : undefined
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
  if (!blob) throw new Error('Encode failed')
  return blobToBytes(blob)
}
