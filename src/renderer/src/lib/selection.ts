import type { LayerNode } from '../types'

export function flatLeafOrder(layers: LayerNode[]): string[] {
  const out: string[] = []
  function walk(nodes: LayerNode[]): void {
    for (const n of nodes) {
      if (n.kind === 'group') walk(n.children ?? [])
      else out.push(n.id)
    }
  }
  walk(layers)
  return out
}

export interface SelectionUpdate {
  click: (id: string, opts: { meta: boolean; shift: boolean }) => Set<string>
}

export function applyClick(
  current: Set<string>,
  anchorId: string | null,
  clickedId: string,
  order: string[],
  opts: { meta: boolean; shift: boolean },
): { selection: Set<string>; anchor: string } {
  if (opts.shift && anchorId) {
    const a = order.indexOf(anchorId)
    const b = order.indexOf(clickedId)
    if (a === -1 || b === -1) {
      return { selection: new Set([clickedId]), anchor: clickedId }
    }
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const next = new Set(order.slice(lo, hi + 1))
    return { selection: next, anchor: anchorId }
  }
  if (opts.meta) {
    const next = new Set(current)
    if (next.has(clickedId)) next.delete(clickedId)
    else next.add(clickedId)
    return { selection: next, anchor: clickedId }
  }
  return { selection: new Set([clickedId]), anchor: clickedId }
}
