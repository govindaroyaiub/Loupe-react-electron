import type { LayerNode } from '../types'

export interface FlatLeaf {
  id: string
  node: LayerNode
  effectiveVisible: boolean
}

export function flattenLeaves(
  layers: LayerNode[],
  visibility: Record<string, boolean>,
  parentVisible = true,
): FlatLeaf[] {
  const result: FlatLeaf[] = []
  for (const layer of layers) {
    const layerVisible = visibility[layer.id] ?? layer.visible
    const effective = parentVisible && layerVisible
    if (layer.kind === 'group') {
      result.push(...flattenLeaves(layer.children ?? [], visibility, effective))
    } else {
      result.push({ id: layer.id, node: layer, effectiveVisible: effective })
    }
  }
  return result
}

export function collectInitialVisibility(layers: LayerNode[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  function walk(nodes: LayerNode[]): void {
    for (const n of nodes) {
      out[n.id] = n.visible
      if (n.children) walk(n.children)
    }
  }
  walk(layers)
  return out
}

/**
 * Returns the ancestor group IDs of the layer with the given id, in order
 * from outermost (top-level) to innermost (direct parent). Excludes target itself.
 */
export function findLayerAncestors(layers: LayerNode[], targetId: string): string[] {
  const result: string[] = []
  function walk(nodes: LayerNode[], path: string[]): boolean {
    for (const n of nodes) {
      if (n.id === targetId) {
        result.push(...path)
        return true
      }
      if (n.children && walk(n.children, [...path, n.id])) return true
    }
    return false
  }
  walk(layers, [])
  return result
}

/**
 * Collects the IDs of all leaf descendants of the given layer.
 * If the target is a leaf, returns a Set containing just its own id.
 * If the target is a group, returns all leaf-layer ids under it (any depth).
 */
export function collectDescendantLeafIds(
  layers: LayerNode[],
  targetId: string,
): Set<string> {
  const result = new Set<string>()
  function findTarget(nodes: LayerNode[]): LayerNode | null {
    for (const n of nodes) {
      if (n.id === targetId) return n
      if (n.children) {
        const found = findTarget(n.children)
        if (found) return found
      }
    }
    return null
  }
  function gatherLeaves(node: LayerNode): void {
    if (node.kind === 'group') {
      for (const child of node.children ?? []) gatherLeaves(child)
    } else {
      result.add(node.id)
    }
  }
  const target = findTarget(layers)
  if (target) gatherLeaves(target)
  return result
}

/**
 * Build a new visibility map that solos the given layer using a
 * sibling-level toggle (Photoshop-style):
 *
 *   - Walks the path from root to target.
 *   - At each level along the path: the path node is ON, its siblings are OFF.
 *   - Off-path siblings' descendants are NOT touched — their eye dots remain
 *     whatever they were. That way, when the user re-enables a sibling group's
 *     eye later, its inner content reappears as it was.
 *   - The target's own descendants are NOT touched either.
 *
 * Net effect for top-level target BG (with siblings CTA, layer1, layer2, layer3):
 *   BG → on, CTA → off (BG/CTA's children preserved), layer1/2/3 → off.
 */
export function buildSoloVisibility(
  layers: LayerNode[],
  targetId: string,
  current: Record<string, boolean>,
): Record<string, boolean> {
  // Find the set of ids on the path from root to target (inclusive).
  const pathSet = new Set<string>()
  function findPath(nodes: LayerNode[], path: string[]): boolean {
    for (const n of nodes) {
      const here = [...path, n.id]
      if (n.id === targetId) {
        for (const id of here) pathSet.add(id)
        return true
      }
      if (n.children && findPath(n.children, here)) return true
    }
    return false
  }
  findPath(layers, [])
  if (pathSet.size === 0) return current

  const next: Record<string, boolean> = { ...current }
  function walk(nodes: LayerNode[]): void {
    for (const n of nodes) {
      if (n.id === targetId) {
        next[n.id] = true
        // Stop — preserve all descendants of the target.
      } else if (pathSet.has(n.id)) {
        // Ancestor of target: visible. Recurse so we toggle siblings deeper in.
        next[n.id] = true
        if (n.children) walk(n.children)
      } else {
        // Off-path sibling: hidden at this level only. Don't touch descendants.
        next[n.id] = false
      }
    }
  }
  walk(layers)
  return next
}

/**
 * Find the topmost VISIBLE leaf layer whose bounding rect contains (x, y).
 * Returns null if no layer is hit.
 */
export function findLayerAt(
  layers: LayerNode[],
  visibility: Record<string, boolean>,
  x: number,
  y: number,
): LayerNode | null {
  const leaves = flattenLeaves(layers, visibility)
  // flattenLeaves returns bottom-to-top render order; iterate top-down.
  for (let i = leaves.length - 1; i >= 0; i--) {
    const leaf = leaves[i]
    if (!leaf.effectiveVisible) continue
    const b = leaf.node.bounds
    const w = b.right - b.left
    const h = b.bottom - b.top
    if (w <= 0 || h <= 0) continue
    if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) {
      return leaf.node
    }
  }
  return null
}
