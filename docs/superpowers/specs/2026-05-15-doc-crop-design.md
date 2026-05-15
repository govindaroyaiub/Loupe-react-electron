# Document Crop — Design Spec

**Date:** 2026-05-15
**Status:** Approved (design); implementation pending
**Owner:** Govinda

## Summary

Add a non-destructive, session-only **document crop** to Loupe. The user drags the existing marquee, then clicks a new `Crop` button to make the cropped rectangle the active doc view. On-screen canvas, rulers, grid, and exports all follow the crop. A `Cropped W×H ✕` pill in the Toolbar removes it. The underlying parsed PSD and per-layer image bytes are never mutated, so reset is instant.

This is the spec for a **doc-level Photoshop-style `Image > Crop`** — not per-layer trim, not export-only cropping. See "Out of scope".

## Goals

- One way to crop: drag marquee → click `Crop`.
- Crop is reversible at any time without re-parsing the PSD.
- Canvas, rulers, grid, status bar, and exports all reflect the crop.
- The user never loses data — the original PSD is the source of truth in memory.

## Out of scope

- Per-layer trim (auto-removing transparent borders on export).
- Sidecar persistence (writing the crop to a file next to the .psd so it survives reopen). The crop is session-only.
- A separate Crop tool in the ToolPalette with drag handles.
- Keyboard shortcut for Apply / Reset. Can be added later if it earns its place.
- Adjusting saved Rules' coordinates when crop changes.

## State and architecture

### New state in `App.tsx`

```ts
const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
```

Coordinates are always in **original document space**. This is the single source of truth.

### Derived value

```ts
const displayBounds = useMemo(
  () => cropRect ?? { x: 0, y: 0, w: doc?.width ?? 0, h: doc?.height ?? 0 },
  [cropRect, doc?.width, doc?.height],
)
```

Every component that currently reads `doc.width` / `doc.height` reads `displayBounds` instead. `doc` itself is never mutated.

### Apply flow

1. User drags a marquee with the existing Marquee tool.
2. `MarqueePanel` shows a new `Crop` button to the left of `+ Rule`.
3. Button is disabled when the marquee is zero-area or fully outside the doc.
4. Click → compute the intersection of the marquee with the doc bounds → `setCropRect(intersection)` → close the marquee → fire the existing `zoom-fit` canvas action so the cropped doc fills the viewport.

### Reset flow

1. While `cropRect != null`, a `Cropped W×H ✕` pill renders in the Toolbar, between the dimensions readout and the `Open` / `Export` buttons.
2. Click `✕` → `setCropRect(null)` → fire `zoom-fit`.

### Lifecycle

- Opening a new PSD clears `cropRect` to `null`.
- `cropRect` is **not** part of the visibility undo stack (`⌘Z`). Reset via the pill is the only way back.

## Component behavior

| Component | Change |
|---|---|
| `Canvas` | Konva stage translates by `(-cropRect.x, -cropRect.y)` and clips its viewport to `displayBounds.w × .h`. Checker background, layer images, grid, selection highlights, guides, marquee, all draw under that translation. Layers fully outside the crop become invisible naturally. On crop apply / reset, dispatches the existing `zoom-fit` action. |
| `Rulers` | Tick origin is `(0,0)` of `displayBounds`. Top ruler runs `0 … displayBounds.w`; left ruler runs `0 … displayBounds.h`. Dual @1x/@2x ticks still apply. Document-edge markers track `displayBounds`. |
| `Grid` | Confined to `displayBounds`. Grid spacing unchanged. |
| `Marquee` | Remains usable while cropped. Marquee rect is captured and stored in **crop-relative** coords while a crop is active. Rules saved from a cropped marquee record their coordinate space as `'crop'` (see Rules below). |
| `Guides` | Stored in **original doc** coords. While cropped, only guides whose position is inside `cropRect` are rendered. Render position is `guidePosition - cropRect.{x,y}`. Dragging an existing guide updates the original-doc coord by adding the drag delta. New guides dragged from rulers while cropped are stored at `dragPosition + cropRect.{x,y}` so they live in original-doc space. |
| `Rules` | Each `Rule` gets an optional `space: 'doc' \| 'crop'` field. Existing rules implicitly default to `'doc'`. Rules created while cropped record `space: 'crop'`. The rules panel labels crop-space rules subtly (e.g., "(cropped)" suffix) so the user knows the coords are local. Re-cropping does **not** translate or invalidate existing rules. |
| `StatusBar` | While cropped, the mouse-position columns show crop-relative coords. Marquee size readout is unchanged (always reports the active marquee size). |
| `Toolbar` | Dimensions readout, while cropped, shows the cropped W×H with a faded `(of full 1200×600)` suffix so context is never lost. The reset pill sits in the same row. |
| `ExportModal` | Adds a single-line note above the preview list: `Output cropped to 580 × 340 px` when `cropRect != null`. No new controls. |
| `lib/export.ts` | `planExports` and `renderLayerToBytes` accept an optional `cropRect` (original-doc coords). For each layer: intersect `layer.bounds` with `cropRect`; skip layers with zero-area intersection from the plan; render onto a canvas sized `cropRect.w × cropRect.h × scale` with the layer drawn at `(layer.bounds.left - cropRect.x, layer.bounds.top - cropRect.y)`, then scaled. Eraser edits compose first (edited canvas → crop intersection → scale). |

## Edge cases

- **Zero-area marquee or marquee fully outside doc:** `Crop` button disabled; tooltip "Marquee must overlap the document".
- **Marquee partially outside doc:** Apply clamps to the intersection with the original doc bounds — no negative coords escape.
- **Crop apply while a guide drag is in progress:** finalize the drag first; apply uses the final guide state.
- **Layers entirely outside the crop on export:** silently dropped from the plan (zero-area intersection).
- **Reopen / Open new PSD:** `cropRect` reset to `null`.
- **Single-layer export with crop active:** the single output filename's dimensions match the crop, not the original layer bounds.
- **Erased pixels:** the live edited canvas is always layer-sized; crop intersection is computed against the layer's bounds, so the erased state survives correctly through the crop math.

## UI placement summary

- **Apply:** `Crop` button inside `MarqueePanel`, immediately left of `+ Rule`, left of the close `✕`.
- **Reset / status:** `Cropped 580×340 ✕` pill in the `Toolbar`, between the dimensions readout and the `Open` / `Export` buttons; shown only while `cropRect != null`.
- **No new tool, no new keyboard shortcut, no new menu item** in v1.

## Open questions / deferred

- Should the StatusBar's mouse-position columns also keep a parallel "original-doc" readout while cropped? Current decision: no, single readout in crop-relative space to avoid clutter. Revisit if confusing.
- Should we add a thin animation (e.g., 150ms ease) when the crop is applied or reset? Current decision: rely on the existing `zoom-fit` motion only.
- Sidecar persistence is deferred; if added later, the schema is `{ crop: { x, y, w, h } }` keyed by the PSD's absolute path.

## Success criteria

- Drag marquee → click `Crop` → doc visually shrinks to the marquee, exports follow, in under one frame for a typical 1200×600 PSD.
- Clicking the reset pill restores the full doc instantly.
- Re-cropping (apply → reset → apply different rect) leaves the underlying parsed PSD identical.
- An exported PNG with crop active is pixel-equivalent to the on-screen cropped view at 100% scale.
- Cmd-Z still only undoes visibility changes — crop is not on the undo stack.
