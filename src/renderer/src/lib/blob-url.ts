const cache = new WeakMap<Uint8Array, string>()

export function blobUrlFor(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return undefined
  const existing = cache.get(bytes)
  if (existing) return existing
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
  cache.set(bytes, url)
  return url
}
