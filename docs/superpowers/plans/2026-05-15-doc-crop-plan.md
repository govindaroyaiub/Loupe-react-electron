# Document Crop — Implementation Plan

**Companion to:** `docs/superpowers/specs/2026-05-15-doc-crop-design.md`
**Date:** 2026-05-15

## One refinement to confirm before coding

The spec proposed a `space: 'doc' | 'crop'` tag on each `Rule` so the rule's coordinates were locked to the space they were captured in. After re-reading the existing code, a simpler model fits cleanly:

- **Always store coords in original-doc space** — `marquee`, `Guide.pos`, `Rule.rect`, `Rule.point`, every existing field.
- **Translate at the display layer only** — `MarqueePanel`, `RulesPanel`, `StatusBar`, `Rulers` subtract `cropRect.{x,y}` when computing visible numbers. The `%` snippets in `MarqueePanel` use `displayBounds.{w,h}` as the denominator while cropped, so a "50%" rule still means "50% of the visible cropped doc".
- **Rules outside the crop:** appear muted/disabled in `RulesPanel` with a small "(outside crop)" hint. Clicking them does nothing while cropped.
- **No new field on `Rule`.** No migration concern.

This is a deviation from the spec section "Rules"; everything else (state shape, Apply/Reset flow, component matrix) is unchanged. Confirm before I start — I'll edit the spec accordingly.

## Phase ordering

Six phases. Each one ends in a state you can manually exercise.

### Phase 1 — Foundation: state + derived bounds (small)

**Goal:** `cropRect` exists in state and `displayBounds` is plumbed to every component that needs it. No visible behavior change yet.

- `src/renderer/src/types.ts`: add and export `interface CropRect { x: number; y: number; w: number; h: number }`. Add `interface DisplayBounds { x: number; y: number; w: number; h: number }` (same shape; named for intent at call sites).
- `src/renderer/src/App.tsx`:
  - `const [cropRect, setCropRect] = useState<CropRect | null>(null)`
  - Memoize `displayBounds`:
    ```ts
    const displayBounds = useMemo<DisplayBounds>(
      () => cropRect ?? { x: 0, y: 0, w: doc?.parsed.width ?? 0, h: doc?.parsed.height ?? 0 },
      [cropRect, doc?.parsed.width, doc?.parsed.height],
    )
    ```
  - Reset `cropRect` to `null` inside `openPsd` after `setDoc(result)`.
  - Add a `resetCrop` callback (just `() => setCropRect(null)`).
  - Pass `cropRect` and `displayBounds` to `Canvas`, `Rulers`, `Toolbar`, `MarqueePanel`, `RulesPanel`, `StatusBar`, `ExportModal` via props (no consumer reads them yet; just the wiring).

**Manual check:** app still works exactly as before; React DevTools shows the new state.

### Phase 2 — Visual crop on canvas + rulers (medium)

**Goal:** If you forcibly call `setCropRect({...})` from DevTools, the canvas and rulers visually crop.

- `src/renderer/src/components/Canvas.tsx`:
  - Accept new props `cropRect: CropRect | null` and `displayBounds: DisplayBounds`.
  - **Clip everything to the crop:** wrap the existing `Layer` blocks (or the whole Stage's drawing) so they clip to `{ x: displayBounds.x, y: displayBounds.y, width: displayBounds.w, height: displayBounds.h }`. Konva clips per-`<Layer>` via the `clip` prop — extend the existing clip on the images Layer and add `clip` props to the other layers (background checker, grid, marquee, guides, selection highlights).
  - **Translate the camera so the crop origin lands at the stage origin:** keep the existing `view.offsetX/offsetY/scale` model, but compose with crop. The cleanest move: the Stage `x`/`y` still come from `view.offsetX/offsetY`, but every doc-space coordinate the Canvas draws against shifts by `-cropRect.{x,y}`. Concretely, the background `Rect`, the per-leaf `<LeafLayer>` positions, the grid lines, the doc-bounds outline, marquee, guides all subtract `cropRect.{x,y}` from any doc-coord they pass to Konva. (Alternative considered: introduce a Konva `Group` translated by `(-cropRect.x, -cropRect.y)` and put everything inside it. Cleaner DOM but the existing `clip` rect uses local coords, so we'd still need to remap. Going with per-element subtraction for less churn.)
  - **Hit testing:** `hitTestLayer` still receives doc-coords (unchanged). `screenToDoc` in the wheel/mouse handlers must continue to return original-doc coords. So `screenToDoc(view, px, py)` returns `{x, y}`, and Canvas adds `displayBounds.{x,y}` back when it has been pre-shifted. Concretely: don't change `screenToDoc`. Instead, when converting pointer → doc-coords for any user-input math, do `const docPos = screenToDoc(view, pointer.x, pointer.y)` and the values are already in original-doc space because we kept stage transform unchanged. The visual shift happens via the `-cropRect` offset baked into each drawn element. (This is the load-bearing detail: input math is unaffected, only render math changes.)
  - **Inside-doc gates** (e.g., `docPos.x >= 0 && docPos.x <= doc.width`) become `docPos.x >= displayBounds.x && docPos.x <= displayBounds.x + displayBounds.w`. Same idea for guide-hit and marquee clamping.
  - **Marquee clamp on drag start/move:** clamp to `displayBounds` instead of `doc.width/height`.
- `src/renderer/src/components/Rulers.tsx`:
  - Accept `displayBounds` (or replace `docWidth/docHeight` with bound width/height + a starting offset).
  - The visible doc band is from `displayBounds.x` to `displayBounds.x + displayBounds.w` (and similarly y).
  - Tick labels are *crop-relative* numbers: when computing the tick at doc-coord `d`, the displayed number is `d - displayBounds.x` (or `- .y`). For non-cropped mode, `displayBounds.x = 0` so behavior is unchanged.
  - The "document extent shaded band" still spans `docZeroX = view.offsetX + displayBounds.x * view.scale` ... `docMaxX = view.offsetX + (displayBounds.x + displayBounds.w) * view.scale`.
  - Hmm wait — actually, the Stage isn't visually shifted by cropRect; only the *contents* are. So the band on the ruler still corresponds to where pixels exist on screen. The doc origin on screen is `view.offsetX`, the crop origin on screen is `view.offsetX + (-cropRect.x)*scale` … no, I'm getting tangled. **Simpler alternative:** translate the Stage itself by `(-cropRect.x * scale, -cropRect.y * scale)` in addition to `view.offsetX/Y`. Then drawn elements are unchanged (they keep using doc coords), and the camera shows the cropped region at the origin. Rulers tick `0…displayBounds.w` because the visible doc starts at `view.offsetX` corresponding to `cropRect.x` in doc-space. We'd then expose `docToScreenOrigin = view.offsetX - cropRect.x * scale` and `view.offsetY - cropRect.y * scale` to the rulers.
  - **Decision:** translate the Stage. It's one knob (`Stage x/y`) and lets every component below stay in doc-coords as it does today. The Stage `x` becomes `view.offsetX - cropRect.x * view.scale`. Same idea on `y`.
  - Ruler tick labels read `displayLocal = docCoord - displayBounds.{x,y}` so a tick at doc-coord 100 with `cropRect.x = 60` shows as `40`.
- `src/renderer/src/App.tsx`:
  - `zoomFit` uses `displayBounds.w/h` (not `doc.parsed.width/height`) so fitting respects the crop.
  - The `lastFitKey` effect's call to `fitView` also uses `displayBounds.w/h`.
  - Add an effect: `useEffect(() => { zoomFit() }, [cropRect])` — auto-fit on apply/reset. (Or call `zoomFit()` inline from the future Crop button + reset pill — same outcome; effect is fewer hand-wirings.)
- `src/renderer/src/components/StatusBar.tsx`:
  - Accept `displayBounds`. The mouse-position readout subtracts `displayBounds.{x,y}` so cropped-mode shows crop-relative coords.
- `src/renderer/src/lib/view.ts` (if needed): `fitView` is unchanged (takes width/height, agnostic to anchor). `screenToDoc` is unchanged.

**Manual check:** open a PSD, set `cropRect` to `{x: 100, y: 100, w: 400, h: 200}` via DevTools; the visible doc shrinks to a 400×200 crop, rulers show 0…400 / 0…200, mouse coords are crop-relative.

### Phase 3 — Apply/Reset UI (small)

**Goal:** No DevTools needed; the user can apply and reset crop from the UI.

- `src/renderer/src/components/MarqueePanel.tsx`:
  - New prop `onApplyCrop: (rect: MarqueeRect) => void`. New prop `canCrop: boolean` (false when marquee zero-area or fully outside doc — App computes).
  - Render a `Crop` button immediately to the left of the close `✕`. (The `+ Rule` button was removed from this panel in a prior cleanup.) Disabled with `title="Marquee must overlap the document"` when `!canCrop`. Click → `onApplyCrop(rect)`.
- `src/renderer/src/App.tsx`:
  - Compute `canCrop = marqueeFinalized && marquee && marquee.width > 0 && marquee.height > 0` (the intersection check is implicit because the marquee is already clamped to doc bounds at capture time; the new clamp in Phase 2 is to `displayBounds`, which is the doc when no crop is active — exactly the case where the user is *about to apply a crop*).
  - `applyCrop` callback: `setCropRect({ x: marquee.x, y: marquee.y, w: marquee.width, h: marquee.height })` then `clearMarquee()`.
- `src/renderer/src/components/Toolbar.tsx`:
  - New props `cropRect: CropRect | null`, `onResetCrop: () => void`.
  - When `cropRect != null`, render a pill `Cropped {w}×{h} ✕` between `<span className="dims">` and the `<div className="actions">`. Click `✕` → `onResetCrop()`.
  - Also update the dims block to show cropped + `(of full WxH)` suffix while cropped.
- `src/renderer/src/assets/main.css`: add `.toolbar .crop-pill` styles (small rounded pill, subtle accent color, an `✕` button).

**Manual check:** marquee → click `Crop` → doc visibly crops, fit zooms in, pill appears. Click `✕` → original doc back. Open new PSD → cleared.

### Phase 4 — Marquee / Guide / Rule display under crop (medium)

**Goal:** Numbers shown to the user are crop-relative when crop is active.

- `src/renderer/src/components/MarqueePanel.tsx`:
  - Accept `displayBounds` (replace `docWidth/docHeight`).
  - In `snippetsFor`, use `displayBounds.w/h` as the percentage denominator. Subtract `displayBounds.{x,y}` from `rect.x/y` before formatting `x/y` (the `w/h` and "transform-origin" math is unchanged because it's about size/center, not position; only the position readout uses displayBounds origin).
  - The displayed `x` / `y` numbers at the top of the panel also subtract `displayBounds.{x,y}`.
- `src/renderer/src/components/StatusBar.tsx`:
  - The marquee size readout is unchanged (size is invariant under translation).
  - Mouse position already crop-relative from Phase 2.
- `src/renderer/src/components/GuidesPanel.tsx`:
  - Accept `displayBounds`. Guide positions display as `pos - displayBounds.{x,y}`.
  - Hide guides outside `displayBounds` (filter the list before rendering).
- `src/renderer/src/components/Canvas.tsx`:
  - Skip rendering guides whose `pos` falls outside `displayBounds`. (The clip prop would visually clip them anyway, but explicitly skipping avoids drawing offscreen lines.)
- `src/renderer/src/components/RulesPanel.tsx`:
  - Accept `displayBounds` (replace `docWidth/docHeight`).
  - Rules display crop-relative numbers (subtract `displayBounds.{x,y}` for the `rect.x/y` and `point.x/y` reads).
  - For each rule, compute `outsideCrop = !rectIntersects(rule.rect, displayBounds)` or `!pointInside(rule.point, displayBounds)`. When true, render with `.muted` class and a small `(outside crop)` suffix; click handlers no-op.
- `src/renderer/src/types.ts`: **no changes** (no `space` field — per the refinement at the top of this plan).
- `src/renderer/src/App.tsx`: pass `displayBounds` to every panel that now consumes it.

**Manual check:** drag a guide while uncropped → save its rule → apply crop that excludes it → rule shows "(outside crop)" and is muted. Drag a new marquee while cropped → snippets compute against crop dimensions; `x/y` are crop-relative.

### Phase 5 — Export integration (small)

**Goal:** Exports honor the crop.

- `src/renderer/src/lib/export.ts`:
  - Add `cropRect?: CropRect` to `ExportOptions`.
  - In `planExports`, for each layer:
    - Compute `effective = cropRect ? intersect(layer.bounds, cropRect) : layer.bounds`.
    - Skip layers with zero-area `effective`.
    - The plan item's `width/height` = `(effective.w * scale, effective.h * scale)` rounded.
  - In `renderLayerToBytes`, if `cropRect` is provided:
    - Output canvas size = `cropRect.w * scale × cropRect.h * scale`.
    - Draw the source image at `((layer.bounds.left - cropRect.x) * scale, (layer.bounds.top - cropRect.y) * scale)` with size `(layerW * scale, layerH * scale)`.
    - Background fill (white/black) covers the full crop, not the layer's tight bounds.
  - The edited-canvas path keeps using `editedCanvas` as `drawSource`, just with the new positioning.
- `src/renderer/src/components/ExportModal.tsx`:
  - Accept `cropRect: CropRect | null`.
  - Add to `opts`: `cropRect: cropRect ?? undefined`.
  - Above the preview list, when `cropRect != null`, render a one-line muted note: `Output cropped to ${cropRect.w} × ${cropRect.h} px`.
- `src/renderer/src/App.tsx`: pass `cropRect` to `ExportModal`.

**Manual check:** apply a crop → export a single layer that straddles the crop boundary → output PNG is `cropW × cropH`, with the layer drawn at the correct offset and transparent outside its bounds.

### Phase 6 — Verify success criteria (small)

Run through every success criterion from the spec:

1. Drag marquee → click `Crop` → doc crops, all panels follow within one frame.
2. Reset pill restores full doc instantly.
3. Re-cropping leaves `doc.parsed` identical (verify with a console check on `editedCanvasesRef`/`doc` object identity).
4. Exported PNG at 100% scale is pixel-equivalent to the on-screen cropped view at 100% (compare with the macOS Preview app side-by-side).
5. `⌘Z` still only undoes visibility/offset/eraser changes — never the crop.
6. Open a new PSD with crop active → crop clears.
7. Marquee+Delete (eraser via Marquee) still works while cropped.
8. Guides created from the ruler while cropped land at the right doc-coord (the Stage translation must be accounted for in `computeDragInfo`; verify in code that `docX = (stageX - v.offsetX + cropRect.x*scale) / v.scale` — equivalently, since we moved Stage by `-cropRect.x*scale`, the input `stageX` already accounts for it. Re-verify with a manual drag).

If any criterion fails, fix in-place and re-verify. Don't move on.

## Files touched (summary)

```
docs/superpowers/specs/2026-05-15-doc-crop-design.md     # update Rules section
src/renderer/src/types.ts                                # add CropRect, DisplayBounds
src/renderer/src/App.tsx                                 # state, derived bounds, callbacks, props
src/renderer/src/components/Canvas.tsx                   # Stage translation, clip, doc-bound gates
src/renderer/src/components/Rulers.tsx                   # tick labels crop-relative, edges
src/renderer/src/components/MarqueePanel.tsx             # Crop button, crop-relative display
src/renderer/src/components/Toolbar.tsx                  # crop pill, dims suffix
src/renderer/src/components/StatusBar.tsx                # crop-relative mouse coords
src/renderer/src/components/GuidesPanel.tsx              # filter + display
src/renderer/src/components/RulesPanel.tsx               # display + outside-crop muting
src/renderer/src/components/ExportModal.tsx              # forward cropRect, note in preview
src/renderer/src/lib/export.ts                           # cropRect in opts, plan, render
src/renderer/src/assets/main.css                         # .crop-pill styles
```

No new files. No new dependencies.

## Risks

- **Stage translation interacting with hit-testing.** The Konva pointer position is in screen-coords; `screenToDoc` reads `view.offsetX/Y` directly. If we change Stage `x` to `view.offsetX - cropRect.x * scale`, then `pointer` coords are still in the unshifted Stage space (because `getPointerPosition()` returns local Stage coords, which are post-translation). I need to verify this carefully during Phase 2 — likely we adjust `screenToDoc` to subtract the crop offset, OR we keep Stage `x = view.offsetX` and translate every drawn element by `-cropRect.{x,y}`. **Mitigation:** prototype both at the start of Phase 2, pick whichever leaves the existing hit-testing code path unchanged.
- **Guides created during drag while cropped.** `computeDragInfo` in `App.tsx` reads `view` directly to compute `docX/docY`. It also clamps against `docDimsRef.current` which is the full doc, not the crop. With the simpler "always doc-coords" model, this still works — a guide dragged at "the top of the visible cropped doc" lands at `cropRect.y` in doc-space, which is correct. No change needed in `computeDragInfo`. ✅
- **Phase 2 complexity.** The Stage-translation question is the hardest part of this whole change. Worst case: I budget extra time, prototype against a saved PSD, and update the plan if needed.

## Open during execution

- The eraser circle preview uses `cursorDoc` in doc-coords. Already works under Stage translation. No change.
- The selection-rect highlight reads `layer.bounds` directly. With Stage translation, it draws at the correct position automatically. No change.
- The doc-bounds white outline (the 1px stroke around the doc) — while cropped, this should outline the *crop*, not the original doc. Phase 2 changes the outline rect to use `displayBounds`.
