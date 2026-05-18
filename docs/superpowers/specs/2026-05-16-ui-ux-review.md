# Loupe UI/UX Review

**Date:** 2026-05-16
**Source:** External UX consultant agent (read-only review of code + CSS, no runtime access)
**Status:** Recommendations — not yet acted on

## Top 5 highest-impact changes

1. **Layer-row eye icon is 10px in a 20px hit target — way too small.** (S) `LayersPanel.tsx:112` renders `EyeOnIcon/EyeOffIcon size={10}` inside a 20×20 button. The row is 32px tall — there's room for a 14–16px glyph in a 24–28px button. The eye is the single most-clicked control in the panel and it's currently the smallest in the app. Same fix: bump `group-chevron-right` (currently 18×18 with a 12px icon) to 22–24×22–24 with a 14px icon.

2. **"⌘+click solo" and the right-click → Trim flow are invisible to anyone who hasn't read the cheat sheet.** (M) No visual affordance, no tooltip beyond the eye icon, no hint anywhere. Add (a) a subtle `⌘` superscript on the eye on hover or in selection mode, (b) a hover hint on canvas saying "⌘-click to solo · right-click for more", and (c) put a small kebab/⋯ menu on each layer row that opens the same menu as right-click (Trim, Solo, Hide others). Right now Trim is unreachable from the keyboard or the panel — only from canvas right-click.

3. **The 300px sidebar is too narrow and the Rules/Layers split is fragile.** (M) Sidebar is `width: 300px`, Rules has `max-height: 40%`. With 1 rule the panel wastes space; with 10 rules it eats half the layer tree. Make the divider draggable, default sidebar width to 320–340px, and let Rules collapse to a header-only state when empty.

4. **MarqueePanel + GuidesPanel float over the canvas at fixed `right:16/left:60, bottom:16` — they overlap the canvas content people are measuring.** (M) Especially bad on smaller banner sizes (300×250 at 100% zoom is ~250px tall, the panel is 220px min-height). Either dock them to a bottom strip below the canvas, or let the user drag them, or auto-collapse to a single status pill when not focused.

5. **Welcome modal copy is unprofessional and breaks the tone of the rest of the app.** (S) The current "I know that the app still has some issues..." copy is endearing but reads as half-finished. Replace with a 30-second "what Loupe does" tour (3 bullets: open PSDs in tabs, measure with marquee/guides, save canvas) and a "Show shortcuts" button. Currently the cheat sheet is the only way to learn the app and it's gated behind ⌘/.

## Detailed findings by area

### Toolbar / TabBar

- `Toolbar.tsx:79` `CloseIcon size={11}` on the crop-pill X is tiny inside a 16×16 circle. Bump to 13.
- The brand "Loupe" with the gradient dot sits left of the doc-info but `padding: 0 16px 0 80px` leaves an 80px gap for the macOS traffic lights — fine on Mac, wasted on Windows. Add `-webkit-app-region: drag` zone responsively.
- `doc-info` has three `•` separators and uses `--text-faint` (rgba 0.32) — the dots disappear against `--bg-toolbar`. Use `--text-dim` or a literal `·` (middle dot, more weight).
- `dims` displays "600 × 1200 px @2x · @1x 300 × 600" — the "@2x ·" is between the numbers, confusing to scan. Rewrite as `600 × 1200 px · @1x: 300 × 600` or stack them visually.
- TabBar has no overflow handling beyond `overflow-x: auto`. With 10+ tabs you get a horizontal scrollbar but no chevrons or "all tabs" dropdown. Add a `▾` button at the right edge listing all tabs.
- `.tab` has `max-width: 220px` but no `min-width` — short filenames make the tab close button feel cramped. Set `min-width: 110px`.
- No tab-reorder (drag-to-reorder), no unsaved-state indicator. No keyboard tab switch (⌘1–9, ⌘⇧[ /⌘⇧]).

### ToolPalette

- 52px wide column at left with 38×38 buttons is fine, but the `kbd` overlay at 8px is illegible. Either drop it or move to a hover tooltip.
- The eraser brush slider lives *between* the tool buttons and the divider, so the palette resizes vertically when you switch tools. This shifts the grid/zoom buttons every time E is pressed. Reserve the space or move brush controls to a separate inspector strip.
- Grid spacing input "px" label at 9px font — unreadable.
- Zoom readout doesn't visually indicate it's clickable (resets to 100%).
- No "fit selection" zoom — useful for inspecting one layer.

### LayersPanel

- Padding-left math `8 + depth * 14` — 14px per level is tight; deep groups crowd against the eye icon. Use 16.
- Flag pills (T, M, C, SO, A, FX) at 9px are illegible. Either remove the rarely-used ones (M, C, A, FX), or replace pills with small monochrome icons.
- The eye-icon tooltip is the only place users learn about solo. Surface this somewhere visible — maybe a one-line hint at the top of the panel on first launch.
- "Show all" + "Clear (N)" link buttons at 11px blend in with the header.
- **No layer search/filter.** With 50+ layers (common in banner PSDs) this is painful. Add ⌘F or a top-of-panel search input.
- No "expand/collapse all" affordance.
- Group rows aren't visually distinct from leaf rows. Faintly bold group names or add a `▸` glyph next to the folder icon.

### RulesPanel

- Empty-state copy describes only one of two ways to make a rule (the other path — saving a marquee — currently doesn't exist; MarqueePanel has no "+ Rule" button despite documentation saying it does). Either ship the marquee→rule path or amend the copy.
- Rule row "Copy CSS" link button at 11px is easy to miss. Make it a small filled chip.
- No way to reorder rules, no group/tag, no export-all-as-CSS.
- Outside-crop rules: Copy button is disabled silently. Add a tooltip explaining.

### MarqueePanel / GuidesPanel

- These two panels claim consistency but their internal hierarchy diverges: MarqueePanel has 4 sections, GuidesPanel crams unit + mode + Save + Close all into the header. Move guide controls to a parallel settings row.
- Padding values are unsystematic — `8 10` on header, `6 10` on settings, `10 12` on dims, `8 10 10` on snippet. Pick one rhythm and stick to it.
- MarqueePanel snippet: dropdown + Copy button + `<pre>` text is three distinct visual rhythms. Try a small segmented control (3 options is fine as segments) and inline label.
- No "+ Rule" button in MarqueePanel even though it's documented.
- GuidesPanel hint at 10.5px `text-faint` is invisible. Promote to 11.5px text-dim or attach to an info icon.

### StatusBar

- 24px tall with 11px text and a chain of `·` separators using `--text-faint` rgba 0.32 — the separators vanish.
- Mouse coords stay at `—` when not over canvas; `tabular-nums` only kicks in on `.nums` spans, so the layout shifts when coords appear. Pre-reserve width.
- Marquee dims at @1x AND @2x both shown adds clutter. Only show the active unit.
- Add "selected: 3 layers" — currently you have to look at the panel header.

### Canvas

- Selected layer dashed blue box overlaps the eraser red circle with no visual priority. When erasing, the dashes flicker through.
- No zoom-to-cursor on `⌘+` / `⌘-` (the keyboard zoom always uses viewport center). Wheel zoom is cursor-anchored, keyboard zoom isn't — inconsistent.
- No mini-map or overview.
- Eraser cursor on small selections looks like a UFO when brushSize > viewport height. Cap the visible cursor radius at the doc bounds.

### Modals

- ShortcutsModal: `.shortcuts-section-title` at 10px is too small — bump to 11.
- ShortcutsModal: two-column grid breaks awkwardly at narrow widths.
- SaveAsModal: form-row `90px label / 1fr value` puts uppercase 12px labels next to controls — fine until the Quality slider; the slider extends past the modal-body padding.
- SaveAsModal preview re-encodes on every keystroke of the JPG slider (debounced 250ms) but no loading indicator on the preview image itself.
- No "save as @1x AND @2x in one shot" — common need for banner asset delivery.
- WelcomeModal: gradient text title `#6e8cff → #b07be8` doesn't match the toolbar brand dot `#4aa3ff → #b16bff`. Pick one brand gradient.

### Color & contrast

- `--text-faint: rgba(235, 235, 245, 0.32)` against `--bg: #1b1b1f` measures ~3.1:1 — **fails WCAG AA for body text**. Used in: status bar separators, ruler tick labels, empty-state hint, guides hint, layer-row dim names, untitled rule names, ⌘/Alt kbd labels. Promote to rgba(...,0.42) for ~4.5:1.
- `--text-dim: rgba(...,0.55)` is around 4.7:1 — borderline AA, OK.
- `--row-hover: rgba(255,255,255,0.04)` is barely perceptible. Bump to 0.06–0.07.
- Disabled state for `.apply-take-btn` uses `rgba(255,255,255,0.04)` which is virtually invisible against the marquee panel bg.
- Tabular numerals are used inconsistently — set `font-variant-numeric: tabular-nums` globally on `body` instead of repeating.

### Discoverability

- **Hidden features:** Take out (Delete key), Trim (right-click), Solo (⌘+click eye or canvas), Nudge (arrows), Brush resize ([ ]). Only the Eraser + Marquee + Hand + Zoom are visible.
- The ⌘/ help shortcut is itself hidden until you find it.

### Naming

- **"Take out"** is jargony — Photoshop calls this "Clear" or "Delete inside selection". Consider renaming to "Erase region" or "Delete inside".
- **"Rules" overloads with "rulers"**. A designer hearing "save a rule" will think it's a CSS rule (the snippet panel) — confusion compounds. "Measurements", "Snippets", or "Saved" would be clearer.
- "Trim to layer" in the context menu is good. But there's no inverse on the marquee.
- Tool tooltip says "Hand (Space)" but the shortcut chip below says "H". Pick one.

### Accessibility

- **No visible focus rings anywhere.** `:focus` is only styled on inputs. Every `<button>` is keyboard-focusable but invisible — keyboard users are lost. Add a global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.
- TabBar uses `role="tablist"` and `aria-selected` but no `aria-controls` linking to a tab panel. Tabs aren't keyboard-navigable (Arrow keys don't switch tabs).
- LayersPanel rows are `<div>` with `onClick` — not keyboard-accessible. They should be `<button>` or have `role="treeitem"` with `tabindex`.
- ContextMenu items don't have arrow-key navigation — Escape closes but no up/down.
- StatusBar has no semantic role; consider `role="status"`.

### What's missing

- **Drag-and-drop file open** (listed as pending in LOUPE_CONTEXT.md) — essential for a desktop app.
- **Recent files** menu (`app.addRecentDocument`).
- **Color picker / eyedropper** — designers asking for hex values of a layer pixel is the #1 missing tool.
- **Layer search** in panel.
- **Distance measurement** between two guides (you have both positions; the delta is a one-liner).
- **Pinned rules** or multiple rule "boards".
- **Zoom percentage input** (typing a number).
- **Export all visible layers as separate PNGs** — was in the original spec.
- **Window title** doesn't show the active filename.

## Quick wins (under an hour each)

- Bump `EyeOnIcon`/`EyeOffIcon` to size 14 and `.layer-row .eye` to 24×24.
- Add global `:focus-visible` outline (one CSS rule).
- Bump `--text-faint` from 0.32 to 0.42.
- Pre-reserve StatusBar coord width so it doesn't jitter.
- Replace the Welcome modal copy with a real 3-bullet "what is Loupe" intro.
- Set `font-variant-numeric: tabular-nums` on `body` once.
- Fix the "Hand (Space)" / "H" tooltip mismatch in ToolPalette.
- Promote the guides-hint and rules-empty text from 10.5/11.5px to 12px.
- Set `min-width: 110px` on `.tab` so close-button never gets cramped.
- Cap eraser-cursor radius visually at the smallest viewport dimension.

## Things that are already good

- The colored "Take out / Crop / Save Rule" buttons in MarqueePanel/GuidesPanel use distinct semantic hues (red/yellow/blue) — instantly readable.
- Tabular-nums on numeric readouts and panels.
- The dark-checker viewport background + light-checker doc background is a clean Photoshop-native idiom.
- 50px sidebar tool palette with proper hover/active feedback feels native.
- Crop pill in toolbar is a great pattern — communicates state + provides the undo.
- ShortcutsModal grid layout with `<kbd>` styling looks professional.
- The lazy warming of editable canvases / alpha cache per tab is invisible to the user and avoids stutter.
- Cursor states (grab/grabbing/ew-resize/ns-resize/crosshair) are correctly tracked and switched.
- The "outside-crop" dimming of rules is a thoughtful detail.
