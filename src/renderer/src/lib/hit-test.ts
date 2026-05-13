import type { LayerNode, LayerOffset } from '../types'
import { blobUrlFor } from './blob-url'
import { flattenLeaves } from './layers'

const ALPHA_THRESHOLD = 8

interface LayerAlphaSampler {
  width: number
  height: number
  alpha: Uint8Array
}

// Module-scoped cache keyed by the layer's image bytes. PSD parses are
// recreated on every open, so byte references change with the document — no
// stale entries linger across opens (cache is GC'd when the parsed doc is).
const samplerCache = new WeakMap<Uint8Array, LayerAlphaSampler>()
// Tracks decode-in-flight promises so concurrent hit-tests don't double-decode.
const decodingCache = new WeakMap<Uint8Array, Promise<LayerAlphaSampler | null>>()

function decodeAlpha(bytes: Uint8Array): Promise<LayerAlphaSampler | null> {
  const cached = decodingCache.get(bytes)
  if (cached) return cached
  const url = blobUrlFor(bytes)
  if (!url) return Promise.resolve(null)
  const p = new Promise<LayerAlphaSampler | null>((resolve) => {
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
      let data: ImageData
      try {
        data = ctx.getImageData(0, 0, img.width, img.height)
      } catch {
        resolve(null)
        return
      }
      const alpha = new Uint8Array(img.width * img.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = data.data[i * 4 + 3]
      const sampler: LayerAlphaSampler = { width: img.width, height: img.height, alpha }
      samplerCache.set(bytes, sampler)
      resolve(sampler)
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
  decodingCache.set(bytes, p)
  return p
}

/**
 * Kicks off async decode of every leaf layer's image. Resolves when all
 * have been decoded (or failed). After this, hit-tests are alpha-aware
 * synchronously.
 */
export async function warmAlphaCache(layers: LayerNode[]): Promise<void> {
  const flat = flattenLeaves(layers, {})
  await Promise.all(
    flat.map((l) => (l.node.image ? decodeAlpha(l.node.image) : Promise.resolve(null))),
  )
}

function sampleAlpha(
  sampler: LayerAlphaSampler,
  localX: number,
  localY: number,
): number {
  if (
    localX < 0 ||
    localY < 0 ||
    localX >= sampler.width ||
    localY >= sampler.height
  ) {
    return 0
  }
  return sampler.alpha[localY * sampler.width + localX]
}

/**
 * Topmost VISIBLE leaf layer whose pixel at (docX, docY) is opaque enough
 * (alpha > ALPHA_THRESHOLD). Falls back to bbox-only test for layers whose
 * image data hasn't been decoded yet (e.g. very first click after open).
 */
export function findLayerAtAlpha(
  layers: LayerNode[],
  visibility: Record<string, boolean>,
  offsets: Record<string, LayerOffset>,
  docX: number,
  docY: number,
): LayerNode | null {
  const leaves = flattenLeaves(layers, visibility)
  for (let i = leaves.length - 1; i >= 0; i--) {
    const leaf = leaves[i]
    if (!leaf.effectiveVisible) continue
    const b = leaf.node.bounds
    const off = offsets[leaf.id] ?? { x: 0, y: 0 }
    const left = b.left + off.x
    const top = b.top + off.y
    const right = b.right + off.x
    const bottom = b.bottom + off.y
    const w = right - left
    const h = bottom - top
    if (w <= 0 || h <= 0) continue
    if (docX < left || docX >= right || docY < top || docY >= bottom) continue

    if (!leaf.node.image) {
      // No raster — treat the bbox as the hit (e.g. text-only layers might
      // arrive without an image in pathological cases).
      return leaf.node
    }
    const sampler = samplerCache.get(leaf.node.image)
    if (!sampler) {
      // Not decoded yet → bbox hit is good enough for now. Kick off decode
      // so the next click is alpha-aware.
      decodeAlpha(leaf.node.image)
      return leaf.node
    }
    const localX = Math.floor(docX - left)
    const localY = Math.floor(docY - top)
    const a = sampleAlpha(sampler, localX, localY)
    if (a > ALPHA_THRESHOLD) return leaf.node
    // Otherwise, transparent pixel here — keep searching below.
  }
  return null
}
