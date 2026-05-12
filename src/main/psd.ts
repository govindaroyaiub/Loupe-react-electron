import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Canvas, createCanvas } from '@napi-rs/canvas'
import { initializeCanvas, readPsd, Layer, Psd } from 'ag-psd'

initializeCanvas((width: number, height: number) => createCanvas(width, height) as never)

export type LayerKind = 'group' | 'layer'

export interface LayerNode {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  opacity: number
  blendMode: string
  bounds: { left: number; top: number; right: number; bottom: number }
  flags: {
    text: boolean
    mask: boolean
    clipping: boolean
    smartObject: boolean
    adjustment: boolean
    effects: boolean
  }
  thumbnail?: Uint8Array
  image?: Uint8Array
  children?: LayerNode[]
}

export interface ParsedPsd {
  width: number
  height: number
  hasComposite: boolean
  composite?: Uint8Array
  layers: LayerNode[]
  totalLeafCount: number
}

const THUMBNAIL_MAX = 48

function makeThumbnail(layerCanvas: Canvas): Uint8Array | undefined {
  const w = layerCanvas.width
  const h = layerCanvas.height
  if (!w || !h) return undefined
  const scale = Math.min(1, THUMBNAIL_MAX / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))
  const thumb = createCanvas(tw, th)
  const ctx = thumb.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(layerCanvas, 0, 0, tw, th)
  return new Uint8Array(thumb.toBuffer('image/png'))
}

function toLayerNode(layer: Layer): LayerNode {
  const isGroup = Array.isArray(layer.children)
  const node: LayerNode = {
    id: randomUUID(),
    name: layer.name ?? '(unnamed)',
    kind: isGroup ? 'group' : 'layer',
    visible: !layer.hidden,
    opacity: layer.opacity ?? 1,
    blendMode: layer.blendMode ?? 'normal',
    bounds: {
      left: layer.left ?? 0,
      top: layer.top ?? 0,
      right: layer.right ?? 0,
      bottom: layer.bottom ?? 0,
    },
    flags: {
      text: !!layer.text,
      mask: !!layer.mask,
      clipping: !!layer.clipping,
      smartObject: !!layer.placedLayer,
      adjustment: !!layer.adjustment,
      effects: !!layer.effects,
    },
  }

  if (isGroup) {
    node.children = layer.children!.map(toLayerNode)
  } else if (layer.canvas) {
    const canvas = layer.canvas as unknown as Canvas
    node.image = new Uint8Array(canvas.toBuffer('image/png'))
    node.thumbnail = makeThumbnail(canvas)
  }

  return node
}

function countLeaves(layers: LayerNode[]): number {
  let n = 0
  for (const l of layers) {
    if (l.kind === 'group') n += countLeaves(l.children ?? [])
    else n += 1
  }
  return n
}

export function parsePsdFile(filePath: string): ParsedPsd {
  const buffer = fs.readFileSync(filePath)
  const psd: Psd = readPsd(buffer)

  const layers = (psd.children ?? []).map(toLayerNode)

  let composite: Uint8Array | undefined
  if (psd.canvas) {
    const c = psd.canvas as unknown as Canvas
    composite = new Uint8Array(c.toBuffer('image/png'))
  }

  return {
    width: psd.width,
    height: psd.height,
    hasComposite: !!composite,
    composite,
    layers,
    totalLeafCount: countLeaves(layers),
  }
}
