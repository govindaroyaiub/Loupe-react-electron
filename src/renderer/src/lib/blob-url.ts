const urlCache = new WeakMap<Uint8Array, string>()
const imageCache = new WeakMap<Uint8Array, HTMLImageElement>()
const imagePromises = new WeakMap<Uint8Array, Promise<HTMLImageElement>>()

export function blobUrlFor(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return undefined
  const existing = urlCache.get(bytes)
  if (existing) return existing
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
  urlCache.set(bytes, url)
  return url
}

/**
 * Synchronously returns the decoded HTMLImageElement for these bytes if it
 * has already finished decoding. Returns null otherwise. Use this inside a
 * useState initializer so a re-mounted consumer doesn't flash blank while
 * waiting for an async decode that already completed.
 */
export function cachedDecodedImage(bytes: Uint8Array | undefined): HTMLImageElement | null {
  if (!bytes) return null
  return imageCache.get(bytes) ?? null
}

/**
 * Decode (or reuse the in-flight decode of) a PNG/JPG byte array into an
 * HTMLImageElement. Concurrent callers for the same bytes share a single
 * decode rather than each starting their own. Resolved images are cached
 * via WeakMap so they're freed automatically when the source bytes are
 * unreferenced (e.g. after a tab closes).
 */
export function decodeImage(bytes: Uint8Array): Promise<HTMLImageElement> {
  const cached = imageCache.get(bytes)
  if (cached) return Promise.resolve(cached)
  const existing = imagePromises.get(bytes)
  if (existing) return existing
  const url = blobUrlFor(bytes)
  if (!url) return Promise.reject(new Error('no blob url'))
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image()
    img.src = url
    img.onload = () => {
      imageCache.set(bytes, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error('image decode failed'))
  })
  imagePromises.set(bytes, p)
  return p
}
