# Layer Trim — Design Spec

**Date:** 2026-05-15
**Status:** Approved (design); implementation in progress

## Summary

Add a non-destructive **per-layer trim** to Loupe. The user two-finger/Ctrl-clicks a layer on the canvas; a small context menu offers "Trim layer". Applying it shrinks the layer's effective bounds to the tight bounding box of its alpha-positive pixels. Canvas, selection highlight, hit-testing, eraser, and exports all follow. `⌘Z` undoes. The underlying parsed PSD and layer image bytes are never mutated.

Composes cleanly with the document crop ([[2026-05-15-doc-crop-design]]): trim shrinks effective bounds, crop intersects them.

## Goals

- One way to trim: right-click a layer → context menu → Trim.
- Trim is reversible at any time via the existing ⌘Z stack — no separate Reset UI.
- Canvas display, selection rect, hit-testing, eraser, and exports respect the trim.
- Re-running Trim on an already-tight layer is a silent no-op.

## Out of scope

- Photoshop's "Trim Away" side-pickers (Top/Bottom/Left/Right checkboxes).
- "Based on corner pixel color" trim modes.
- Trimming non-leaf groups (only individual layers).
- Trimming multiple layers in one action.
- Keyboard shortcut for trim. (Can be added later if it earns its place.)

## State and architecture

### New type

```ts
export interface LayerTrim {
  /** Inset from the original layer.bounds.left to the tight content's left. */
  dx: number
  /** Inset from the original layer.bounds.top to the tight content's top. */
  dy: number
  /** Tight content width. */
  w: number
  /** Tight content height. */
  h: number
}
```

### State change

Add `trims: Record<string, LayerTrim>` to `DocStateSnapshot` (in `App.tsx`). It lives alongside `visibility`, `offsets`, and `bitmapVersions`. Because it's part of the snapshot, the existing undo stack covers it for free — pushing a `HistoryEntry` before mutating gives ⌘Z support automatically.

### Effective-bounds helper

```ts
function effLayerBounds(layer: LayerNode, trim: LayerTrim | undefined) {
  if (!trim) return layer.bounds
  return {
    left: layer.bounds.left + trim.dx,
    top: layer.bounds.top + trim.dy,
    right: layer.bounds.left + trim.dx + trim.w,
    bottom: layer.bounds.top + trim.dy + trim.h,
  }
}
```

Lives in `lib/layer-trim.ts` (alongside the bbox scan helper).

### Trim flow

1. User two-finger/Ctrl-clicks on canvas.
2. `Canvas` reads `event.clientX/Y`, converts to absolute doc coord, runs `hitTestLayer` to find the topmost visible layer under the cursor. (`event.preventDefault()` to suppress the OS-default menu.)
3. App opens a context menu (small floating React component) at the cursor, with one item: `Trim layer "<name>"`.
4. Click → `trimLayer(layerId)`:
   - Reads the layer's editable canvas (always present after warm-up).
   - Calls `scanCanvasBBox(canvas) → { x, y, w, h } | null`.
   - If `null` (fully transparent) or already-tight (bbox equals current trim), do nothing.
   - Else: push a history snapshot, then set `trims[layerId] = bbox`.
5. Outside-click or `Escape` closes the menu without action.

### Trim computation (`lib/layer-trim.ts`)

```ts
export function scanCanvasBBox(canvas: HTMLCanvasElement): LayerTrim | null {
  // Reads ImageData once. Walks rows/columns to find min/max x and y where
  // alpha > 0. Returns null if no opaque pixel exists.
  // Returns trim values relative to (0, 0) of the source canvas — caller
  // stores them as-is in trims[id].
}
```

The scan is run on the **full editable canvas** (ignoring any existing trim). Trim is therefore idempotent: re-running on a tight layer yields the same bbox, and the equality check in `trimLayer` makes it a no-op.

## Component behavior

| Component | Change |
|---|---|
| `Canvas.LeafLayer` | When the layer has a trim, render Konva `<Image>` with `crop={{ x: dx, y: dy, width: w, height: h }}` and explicit `width={trim.w} height={trim.h}`, positioned at `effLeft + offX, effTop + offY`. Without a trim it falls back to today's behavior. |
| `Canvas` selection rects | Compute from `effLayerBounds(layer, trims[id])` instead of `layer.bounds`. Selection wraps the tight content. |
| `Canvas` `onContextMenu` | Prevent default. Compute doc coord, call `hitTestLayer`. If hit, notify App with `{ clientX, clientY, layerId }`. App opens the context menu. |
| `Canvas` eraser `cursorDoc` | Unchanged — eraser preview is brush-shaped at the cursor, independent of trim. |
| `lib/hit-test.ts` `findLayerAtAlpha` | Takes a `trims` map. Layer-local pixel lookup adjusts by `trim.dx, trim.dy` so the alpha cache reads at `(docX - effLeft - offX + dx)`. Effective bounds also gate the bbox-fallback check. |
| `App.docToLayerLocal` | Takes the trim into account: returns layer-local coord shifted by `(dx, dy)` so the eraser writes to the correct sub-rect of the editable canvas. |
| `lib/export.ts` `planExports` | Uses `effLayerBounds(layer, trims[id])` for bounds checks and item dimensions. |
| `lib/export.ts` `renderLayerToBytes` | Accepts the trim. Source `drawImage` reads the trim sub-rect (`sx=dx, sy=dy, sWidth=w, sHeight=h`) instead of the full source. Destination position uses `effLayerBounds`. |
| `App.tsx` | New `trims` slice on `DocStateSnapshot`; `trimLayer(layerId)` callback; context-menu state `{ open, x, y, layerId, layerName }`; right-click → open-menu wiring. `trims` reset on open PSD. |
| `components/ContextMenu.tsx` (new) | Small absolute-positioned div rendered at the cursor. Closes on outside-click / Escape. Renders a list of `{ label, action, disabled? }` items. For now: one item, `Trim layer "<name>"`. |

## Edge cases

- **Layer with no transparent pixels:** scan returns the full canvas bbox; trim is a no-op (no change vs. existing bounds).
- **Layer that is entirely transparent:** scan returns `null`; trim is a no-op.
- **Right-clicking on the empty canvas (no hit):** no menu opens.
- **Right-clicking while a marquee is being dragged:** suppress the menu (let the marquee finish first).
- **Trim + Crop active:** export uses `effLayerBounds` intersected with `cropRect`. Both compose; nothing special-cased.
- **Trim + layer offset (arrow-key move):** effective bounds shift by both `trim.{dx,dy}` and `offsets[id].{x,y}`. Selection rect, hit-test, and export all see the composed position correctly.
- **Eraser on a trimmed layer:** strokes still go to the full editable canvas; the trim region just happens to be the visible window. If the user erases pixels that are inside the trim, the trim's tight bbox is now stale (smaller area still has content). We don't auto-re-trim — the user can re-run Trim to re-tighten. Acceptable.
- **Re-trim after erasure:** running Trim again scans the (possibly more-transparent) canvas and shrinks further. Always idempotent at steady state.
- **Open a new PSD:** `trims` resets to `{}`.

## Success criteria

- Right-click a layer with transparent borders → context menu appears at cursor with "Trim layer" item, layer name shown.
- Clicking Trim shrinks the layer's selection rect to its tight content within one frame.
- `⌘Z` after a Trim restores the layer's original bounds.
- Exporting a trimmed layer (no crop) yields a PNG sized to the trim's `w × h`.
- Exporting a trimmed layer with a crop active yields the crop-sized PNG with the trimmed content drawn at the correct position.
- Re-running Trim on an already-tight layer does nothing (no history entry pushed).
- Right-clicking on an empty canvas area does nothing.
