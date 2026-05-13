import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from './components/Canvas'
import { LayersPanel } from './components/LayersPanel'
import { Toolbar } from './components/Toolbar'
import { ExportModal } from './components/ExportModal'
import { ToolPalette } from './components/ToolPalette'
import { Rulers, RULER_THICKNESS } from './components/Rulers'
import { MarqueePanel } from './components/MarqueePanel'
import { GuidesPanel } from './components/GuidesPanel'
import { RulesPanel } from './components/RulesPanel'
import { UpdateBanner } from './components/UpdateBanner'
import { StatusBar } from './components/StatusBar'
import { CrosshairIcon } from './components/icons'
import { buildSoloVisibility, collectInitialVisibility } from './lib/layers'
import { findLayerAtAlpha, invalidateAlphaForLayer, warmAlphaCache } from './lib/hit-test'
import {
  eraseCircle,
  eraseLineSegment,
  eraseRect,
  restoreCanvas,
  snapshotCanvas,
  warmEditableCanvases,
} from './lib/layer-edit'
import { flatLeafOrder, applyClick } from './lib/selection'
import { fitView, setZoom, zoomAt, type ViewState } from './lib/view'
import type {
  DraggingGuide,
  GridConfig,
  Guide,
  GuideOrientation,
  LayerNode,
  LayerOffset,
  MarqueeRect,
  OpenedDocument,
  Rule,
  Tool,
} from './types'

interface DocStateSnapshot {
  visibility: Record<string, boolean>
  offsets: Record<string, LayerOffset>
  // Bumped each time a layer's editable canvas is mutated. Used to force
  // React + Konva to re-render after in-place pixel edits.
  bitmapVersions: Record<string, number>
}

/**
 * One step of undo history. Most entries just hold the previous snapshot.
 * Bitmap edits additionally carry a per-layer pixel restore point so undo
 * can revert the in-place canvas mutation.
 */
interface HistoryEntry {
  snapshot: DocStateSnapshot
  bitmapPrev?: { layerId: string; imageData: ImageData }
}

function basenameNoExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p
  return base.replace(/\.psd$/i, '')
}

function collectLeaves(layers: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = []
  function walk(nodes: LayerNode[]): void {
    for (const n of nodes) {
      if (n.kind === 'group') walk(n.children ?? [])
      else out.push(n)
    }
  }
  walk(layers)
  return out
}

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

function App(): React.JSX.Element {
  const [doc, setDoc] = useState<OpenedDocument | null>(null)
  // Combined state so visibility, layer offsets, bitmap versions, and their
  // undo history update atomically.
  const [docState, setDocState] = useState<{
    current: DocStateSnapshot
    history: HistoryEntry[]
  }>({
    current: { visibility: {}, offsets: {}, bitmapVersions: {} },
    history: [],
  })
  const visibility = docState.current.visibility
  const offsets = docState.current.offsets
  const bitmapVersions = docState.current.bitmapVersions
  // Live editable canvases for layers — kept outside React state because
  // canvas mutations are tracked through bitmapVersions instead.
  const editedCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const [tool, setTool] = useState<Tool>('select')
  // Eraser brush diameter in PSD pixels (not CSS px). Persists across tool
  // switches. Single value — eraser is always circular.
  const [brushSize, setBrushSize] = useState<number>(40)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const modKeyHeldRef = useRef(false)
  const [view, setView] = useState<ViewState>({ scale: 1, offsetX: 0, offsetY: 0 })
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null)
  const [marqueeFinalized, setMarqueeFinalized] = useState(false)
  const [grid, setGrid] = useState<GridConfig>({ enabled: false, spacing: 50 })
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [draggingGuide, setDraggingGuide] = useState<DraggingGuide | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  const [focusRuleId, setFocusRuleId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const HISTORY_MAX = 50

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 800, height: 600 })

  // Refs kept in sync so global drag handlers see fresh values.
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const docDimsRef = useRef({ width: 0, height: 0 })
  useEffect(() => {
    if (doc) docDimsRef.current = { width: doc.parsed.width, height: doc.parsed.height }
  }, [doc])

  // Pre-decode every leaf layer's image for alpha-aware hit testing as soon
  // as a doc is opened. The first click after open falls back to bbox; later
  // clicks are pixel-accurate. Also decode an editable canvas per layer so
  // eraser strokes have somewhere to draw without an async stall.
  useEffect(() => {
    if (!doc) return
    warmAlphaCache(doc.parsed.layers).catch(() => {
      /* decode failures fall back to bbox automatically */
    })
    warmEditableCanvases(doc.parsed.layers, editedCanvasesRef.current).catch(() => {
      /* a failed decode just means erasing on that layer is a no-op */
    })
  }, [doc])

  // Live drag baseline: offsets snapshot + ids captured at mousedown so each
  // mousemove can apply a pristine delta instead of compounding rounding.
  const dragBaselineRef = useRef<{
    ids: string[]
    baseline: Record<string, LayerOffset>
  } | null>(null)

  useLayoutEffect(() => {
    if (!viewportRef.current) return
    const el = viewportRef.current
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setViewport({ width: rect.width, height: rect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const computeDragInfo = useCallback(
    (clientX: number, clientY: number, orientation: GuideOrientation) => {
      const vpEl = viewportRef.current
      if (!vpEl) return null
      const rect = vpEl.getBoundingClientRect()
      const vpX = clientX - rect.left
      const vpY = clientY - rect.top
      const overRuler = vpX < RULER_THICKNESS || vpY < RULER_THICKNESS
      const stageX = vpX - RULER_THICKNESS
      const stageY = vpY - RULER_THICKNESS
      const v = viewRef.current
      const docX = (stageX - v.offsetX) / v.scale
      const docY = (stageY - v.offsetY) / v.scale
      return {
        pos: orientation === 'vertical' ? docX : docY,
        overRuler,
        docX,
        docY,
      }
    },
    [],
  )

  const runGuideDrag = useCallback(
    (orientation: GuideOrientation, commitWithId?: string) => {
      const onMove = (ev: MouseEvent) => {
        const r = computeDragInfo(ev.clientX, ev.clientY, orientation)
        if (!r) return
        setDraggingGuide({
          id: commitWithId,
          orientation,
          pos: r.pos,
          overRuler: r.overRuler,
        })
      }
      const onUp = (ev: MouseEvent) => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        const r = computeDragInfo(ev.clientX, ev.clientY, orientation)
        setDraggingGuide(null)
        if (!r) return
        if (r.overRuler) return
        const dims = docDimsRef.current
        const inDoc =
          orientation === 'vertical'
            ? r.docX >= 0 && r.docX <= dims.width
            : r.docY >= 0 && r.docY <= dims.height
        if (!inDoc) return
        setGuides((gs) => {
          const filtered = commitWithId ? gs.filter((g) => g.id !== commitWithId) : gs
          const id =
            commitWithId ?? `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
          return [...filtered, { id, orientation, pos: r.pos }]
        })
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [computeDragInfo],
  )

  const onGuideDragStartFromRuler = useCallback(
    (orientation: GuideOrientation, e: React.MouseEvent) => {
      e.preventDefault()
      const r = computeDragInfo(e.clientX, e.clientY, orientation)
      if (r) setDraggingGuide({ orientation, pos: r.pos, overRuler: r.overRuler })
      runGuideDrag(orientation)
    },
    [computeDragInfo, runGuideDrag],
  )

  const onGuideMouseDown = useCallback(
    (guideId: string) => {
      const guide = guides.find((g) => g.id === guideId)
      if (!guide) return
      setGuides((gs) => gs.filter((g) => g.id !== guideId))
      setDraggingGuide({
        id: guideId,
        orientation: guide.orientation,
        pos: guide.pos,
        overRuler: false,
      })
      runGuideDrag(guide.orientation, guideId)
    },
    [guides, runGuideDrag],
  )

  const clearGuides = useCallback(() => setGuides([]), [])

  function makeRuleId(): string {
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }

  const saveMarqueeAsRule = useCallback((rect: MarqueeRect) => {
    const id = makeRuleId()
    setRules((rs) => [{ id, name: '', kind: 'marquee', rect }, ...rs])
    setFocusRuleId(id)
  }, [])

  const saveGuideIntersectionAsRule = useCallback((point: { x: number; y: number }) => {
    const id = makeRuleId()
    setRules((rs) => [{ id, name: '', kind: 'guide-intersection', point }, ...rs])
    setFocusRuleId(id)
  }, [])

  const renameRule = useCallback((id: string, name: string) => {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, name } : r)))
  }, [])

  const deleteRule = useCallback((id: string) => {
    setRules((rs) => rs.filter((r) => r.id !== id))
  }, [])

  // Fit view when a new document loads or viewport size meaningfully changes.
  const lastFitKey = useRef<string>('')
  useEffect(() => {
    if (!doc) return
    const key = `${doc.filePath}|${viewport.width}|${viewport.height}`
    if (lastFitKey.current === key) return
    lastFitKey.current = key
    setView(
      fitView(
        doc.parsed.width,
        doc.parsed.height,
        Math.max(50, viewport.width - RULER_THICKNESS),
        Math.max(50, viewport.height - RULER_THICKNESS),
      ),
    )
  }, [doc, viewport.width, viewport.height])

  const openPsd = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.loupe.pickAndParsePsd()
      if (result) {
        setDoc(result)
        editedCanvasesRef.current = new Map()
        setDocState({
          current: {
            visibility: collectInitialVisibility(result.parsed.layers),
            offsets: {},
            bitmapVersions: {},
          },
          history: [],
        })
        setSelection(new Set())
        setAnchorId(null)
        setMarquee(null)
        setMarqueeFinalized(false)
        lastFitKey.current = ''
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy])

  useEffect(() => {
    return window.loupe.onMenuOpenPsd(() => {
      openPsd()
    })
  }, [openPsd])

  const toggleCollapsedGroup = useCallback((id: string) => {
    setCollapsedGroups((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const leafOrder = useMemo(
    () => (doc ? flatLeafOrder(doc.parsed.layers) : []),
    [doc],
  )

  const onSelect = useCallback(
    (id: string, opts: { meta: boolean; shift: boolean }) => {
      const result = applyClick(selection, anchorId, id, leafOrder, opts)
      setSelection(result.selection)
      setAnchorId(result.anchor)
    },
    [selection, anchorId, leafOrder],
  )

  // Helper: append a new entry to history, evicting the oldest when full.
  function pushEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
    return history.length >= HISTORY_MAX
      ? [...history.slice(1), entry]
      : [...history, entry]
  }

  // Single atomic setState: append the current snapshot to history AND swap in
  // the new visibility in one go. Avoids the nested-setState pitfall.
  const commitVisibilityChange = useCallback(
    (nextFor: (current: Record<string, boolean>) => Record<string, boolean>) => {
      setDocState((s) => {
        const snap = s.current
        return {
          current: { ...snap, visibility: nextFor(snap.visibility) },
          history: pushEntry(s.history, { snapshot: snap }),
        }
      })
    },
    [],
  )

  // Apply an offset change without pushing history. Used for live drag updates;
  // caller is expected to push a history entry once at drag start.
  const updateOffsetsLive = useCallback(
    (nextFor: (current: Record<string, LayerOffset>) => Record<string, LayerOffset>) => {
      setDocState((s) => ({
        current: { ...s.current, offsets: nextFor(s.current.offsets) },
        history: s.history,
      }))
    },
    [],
  )

  // Apply an offset change AND push a history snapshot. For discrete moves
  // (arrow-key nudges).
  const commitOffsetChange = useCallback(
    (nextFor: (current: Record<string, LayerOffset>) => Record<string, LayerOffset>) => {
      setDocState((s) => {
        const snap = s.current
        return {
          current: { ...snap, offsets: nextFor(snap.offsets) },
          history: pushEntry(s.history, { snapshot: snap }),
        }
      })
    },
    [],
  )

  // Begin a bitmap edit on a layer: snapshot its current pixels so an undo can
  // revert the upcoming mutation. The actual pixel work (eraseCircle etc.)
  // happens directly against the canvas in editedCanvasesRef.
  const beginBitmapEdit = useCallback((layerId: string) => {
    const canvas = editedCanvasesRef.current.get(layerId)
    if (!canvas) return false
    const prev = snapshotCanvas(canvas)
    if (!prev) return false
    setDocState((s) => ({
      current: s.current,
      history: pushEntry(s.history, {
        snapshot: s.current,
        bitmapPrev: { layerId, imageData: prev },
      }),
    }))
    return true
  }, [])

  // After a bitmap mutation, bump the version so Canvas/Konva re-render the
  // affected layer. The pixel data lives on the canvas already; this only
  // signals React that there's something new to paint.
  const bumpBitmapVersion = useCallback((layerId: string) => {
    invalidateAlphaForLayer(layerId)
    setDocState((s) => ({
      current: {
        ...s.current,
        bitmapVersions: {
          ...s.current.bitmapVersions,
          [layerId]: (s.current.bitmapVersions[layerId] ?? 0) + 1,
        },
      },
      history: s.history,
    }))
  }, [])

  // Sync hit-test for the Select tool. Uses the alpha-aware lookup that
  // respects current visibility + per-layer offsets. Falls back to bbox for
  // any layer whose image hasn't decoded yet.
  const hitTestLayer = useCallback(
    (docX: number, docY: number): string | null => {
      if (!doc) return null
      const node = findLayerAtAlpha(
        doc.parsed.layers,
        visibility,
        offsets,
        docX,
        docY,
        editedCanvasesRef.current,
      )
      return node?.id ?? null
    },
    [doc, visibility, offsets, bitmapVersions],
  )

  const selectLayerById = useCallback((id: string) => {
    setSelection(new Set([id]))
    setAnchorId(id)
  }, [])

  const toggleSelectLayer = useCallback((id: string) => {
    setSelection((sel) => {
      const next = new Set(sel)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchorId(id)
  }, [])

  // Start a layer-drag: snapshot the offsets of the ids we'll be dragging,
  // and push the current state onto history so undo reverts the whole drag.
  const beginLayerDrag = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setDocState((s) => {
      const baseline: Record<string, LayerOffset> = {}
      for (const id of ids) baseline[id] = s.current.offsets[id] ?? { x: 0, y: 0 }
      dragBaselineRef.current = { ids, baseline }
      return {
        current: s.current,
        history: pushEntry(s.history, { snapshot: s.current }),
      }
    })
  }, [])

  // Live update during drag — compute new offsets = baseline + (dx, dy).
  const updateLayerDrag = useCallback((dx: number, dy: number) => {
    const baseline = dragBaselineRef.current
    if (!baseline) return
    updateOffsetsLive((current) => {
      const next = { ...current }
      for (const id of baseline.ids) {
        const b = baseline.baseline[id]
        next[id] = { x: b.x + dx, y: b.y + dy }
      }
      return next
    })
  }, [updateOffsetsLive])

  const endLayerDrag = useCallback(() => {
    dragBaselineRef.current = null
  }, [])

  // Find the layer-local pixel coordinates that correspond to a document
  // point, accounting for the layer's bounds and current offset. Returns null
  // if there's no editable canvas for this layer (failed decode).
  const docToLayerLocal = useCallback(
    (
      layerId: string,
      docX: number,
      docY: number,
    ): { x: number; y: number; canvas: HTMLCanvasElement } | null => {
      if (!doc) return null
      const canvas = editedCanvasesRef.current.get(layerId)
      if (!canvas) return null
      // Find the layer's bounds in the parsed tree.
      let bounds: { left: number; top: number; right: number; bottom: number } | null = null
      function walk(nodes: LayerNode[]): boolean {
        for (const n of nodes) {
          if (n.id === layerId) {
            bounds = n.bounds
            return true
          }
          if (n.children && walk(n.children)) return true
        }
        return false
      }
      walk(doc.parsed.layers)
      if (!bounds) return null
      const off = offsets[layerId] ?? { x: 0, y: 0 }
      const b: { left: number; top: number; right: number; bottom: number } = bounds
      return {
        x: docX - (b.left + off.x),
        y: docY - (b.top + off.y),
        canvas,
      }
    },
    [doc, offsets],
  )

  // Push history + remember the layer's pre-stroke pixels so undo reverts the
  // entire stroke as one action.
  const eraseStrokeBegin = useCallback(
    (layerId: string): boolean => beginBitmapEdit(layerId),
    [beginBitmapEdit],
  )

  const eraseStrokeDot = useCallback(
    (layerId: string, docX: number, docY: number, radius: number) => {
      const local = docToLayerLocal(layerId, docX, docY)
      if (!local) return
      eraseCircle(local.canvas, local.x, local.y, radius)
      bumpBitmapVersion(layerId)
    },
    [docToLayerLocal, bumpBitmapVersion],
  )

  const eraseStrokeSegment = useCallback(
    (
      layerId: string,
      docX0: number,
      docY0: number,
      docX1: number,
      docY1: number,
      radius: number,
    ) => {
      const a = docToLayerLocal(layerId, docX0, docY0)
      const b = docToLayerLocal(layerId, docX1, docY1)
      if (!a || !b) return
      eraseLineSegment(a.canvas, a.x, a.y, b.x, b.y, radius)
      bumpBitmapVersion(layerId)
    },
    [docToLayerLocal, bumpBitmapVersion],
  )

  // Marquee+Delete: clear the marquee rect from the single selected layer.
  // Pushes history as one undo step. No-op if the rect doesn't intersect the
  // layer's bounds at all.
  const eraseMarqueeFromLayer = useCallback(
    (layerId: string, rect: MarqueeRect) => {
      const topLeft = docToLayerLocal(layerId, rect.x, rect.y)
      if (!topLeft) return
      if (!beginBitmapEdit(layerId)) return
      eraseRect(topLeft.canvas, topLeft.x, topLeft.y, rect.width, rect.height)
      bumpBitmapVersion(layerId)
    },
    [docToLayerLocal, beginBitmapEdit, bumpBitmapVersion],
  )

  // Manual eye toggle is also undoable — every visibility change pushes.
  const toggleVisibility = useCallback(
    (id: string) => {
      commitVisibilityChange((v) => ({ ...v, [id]: !v[id] }))
    },
    [commitVisibilityChange],
  )

  const onCanvasSelectLayer = useCallback(
    (layerId: string) => {
      setSelection(new Set([layerId]))
      setAnchorId(layerId)
      if (doc) {
        commitVisibilityChange((current) =>
          buildSoloVisibility(doc.parsed.layers, layerId, current),
        )
      }
    },
    [doc, commitVisibilityChange],
  )

  const undoLast = useCallback(() => {
    if (docState.history.length === 0) return false
    setDocState((s) => {
      if (s.history.length === 0) return s
      const entry = s.history[s.history.length - 1]
      // If this step also mutated pixels, restore the canvas now. The pixel
      // restore happens on the live canvas in the ref; the snapshot below
      // will roll back bitmapVersions to match.
      if (entry.bitmapPrev) {
        const canvas = editedCanvasesRef.current.get(entry.bitmapPrev.layerId)
        if (canvas) restoreCanvas(canvas, entry.bitmapPrev.imageData)
        invalidateAlphaForLayer(entry.bitmapPrev.layerId)
      }
      return { current: entry.snapshot, history: s.history.slice(0, -1) }
    })
    return true
  }, [docState.history.length])

  const showAllLayers = useCallback(() => {
    if (!doc) return
    commitVisibilityChange(() => {
      const next: Record<string, boolean> = {}
      function walk(nodes: LayerNode[]): void {
        for (const n of nodes) {
          next[n.id] = true
          if (n.children) walk(n.children)
        }
      }
      walk(doc.parsed.layers)
      return next
    })
  }, [doc, commitVisibilityChange])

  const isModKeyHeld = useCallback(() => modKeyHeldRef.current, [])

  const clearSelection = useCallback(() => {
    setSelection(new Set())
    setAnchorId(null)
  }, [])

  const is2x = useMemo(() => {
    if (!doc) return false
    return doc.parsed.width % 2 === 0 && doc.parsed.height % 2 === 0
  }, [doc])

  const compatWarning = useMemo(() => {
    if (!doc) return null
    if (!doc.parsed.hasComposite) {
      return 'This PSD was saved without "Maximize Compatibility" — some layers may render incorrectly. Ask the designer to re-save with that option enabled.'
    }
    return null
  }, [doc])

  const exportLayers = useMemo<LayerNode[]>(() => {
    if (!doc) return []
    const allLeaves = collectLeaves(doc.parsed.layers)
    if (selection.size === 0) return allLeaves
    return allLeaves.filter((l) => selection.has(l.id))
  }, [doc, selection])

  const openExport = useCallback(() => {
    if (!doc || exportLayers.length === 0) return
    setExportOpen(true)
  }, [doc, exportLayers])

  const handleMarqueeChange = useCallback((next: MarqueeRect | null, finalized: boolean) => {
    setMarquee(next)
    setMarqueeFinalized(finalized && !!next && next.width > 1 && next.height > 1)
  }, [])

  const clearMarquee = useCallback(() => {
    setMarquee(null)
    setMarqueeFinalized(false)
  }, [])

  // Zoom helpers center the zoom on the viewport center.
  const zoomCenter = useCallback(() => {
    return { x: viewport.width / 2, y: viewport.height / 2 }
  }, [viewport])

  const zoomIn = useCallback(() => {
    const c = zoomCenter()
    setView((v) => zoomAt(v, c.x, c.y, 1.25))
  }, [zoomCenter])

  const zoomOut = useCallback(() => {
    const c = zoomCenter()
    setView((v) => zoomAt(v, c.x, c.y, 1 / 1.25))
  }, [zoomCenter])

  const zoomFit = useCallback(() => {
    if (!doc) return
    setView(
      fitView(
        doc.parsed.width,
        doc.parsed.height,
        Math.max(50, viewport.width - RULER_THICKNESS),
        Math.max(50, viewport.height - RULER_THICKNESS),
      ),
    )
  }, [doc, viewport])

  const zoom100 = useCallback(() => {
    const c = zoomCenter()
    setView((v) => setZoom(v, 1, c.x, c.y))
  }, [zoomCenter])

  useEffect(() => {
    if (typeof window.loupe.onCanvasAction !== 'function') return
    return window.loupe.onCanvasAction((action: string) => {
      if (action === 'zoom-in') zoomIn()
      else if (action === 'zoom-out') zoomOut()
      else if (action === 'zoom-100') zoom100()
      else if (action === 'zoom-fit') zoomFit()
    })
  }, [zoomIn, zoomOut, zoom100, zoomFit])

  // Track Cmd/Alt for click-time fallback (some trackpad clicks arrive with
  // modifier state inconsistent — rely on tracked key state too).
  useEffect(() => {
    const updateMod = (e: KeyboardEvent) => {
      modKeyHeldRef.current = e.metaKey || e.altKey
    }
    const onBlur = () => {
      modKeyHeldRef.current = false
    }
    window.addEventListener('keydown', updateMod, true)
    window.addEventListener('keyup', updateMod, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', updateMod, true)
      window.removeEventListener('keyup', updateMod, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingInField(e.target)) return

      // Tool shortcuts
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          setTool('select')
          return
        }
        if (e.key === 'm' || e.key === 'M') {
          setTool('marquee')
          return
        }
        if (e.key === 'h' || e.key === 'H') {
          setTool('hand')
          return
        }
        if (e.key === 'e' || e.key === 'E') {
          setTool('eraser')
          return
        }
        if (e.key === 'g' || e.key === 'G') {
          setGrid((g) => ({ ...g, enabled: !g.enabled }))
          return
        }
        // Bracket keys resize the eraser brush. Step scales with current
        // size so the controls stay useful at any scale.
        if (e.key === '[' || e.key === ']') {
          e.preventDefault()
          setBrushSize((s) => {
            const step = Math.max(1, Math.round(s * 0.15))
            const next = e.key === ']' ? s + step : s - step
            return Math.min(500, Math.max(1, next))
          })
          return
        }
        if (e.key === 'Escape') {
          if (marquee) {
            clearMarquee()
            return
          }
          if (selection.size > 0) {
            clearSelection()
            return
          }
        }
        // Marquee + Delete/Backspace: clear the marquee rect from the single
        // selected layer. No-op otherwise.
        if (
          (e.key === 'Delete' || e.key === 'Backspace') &&
          marqueeFinalized &&
          marquee &&
          selection.size === 1
        ) {
          e.preventDefault()
          const [layerId] = Array.from(selection)
          eraseMarqueeFromLayer(layerId, marquee)
          clearMarquee()
          return
        }
        if (e.code === 'Space' && !spaceHeld) {
          e.preventDefault()
          setSpaceHeld(true)
          return
        }

        // Arrow-key nudge of selected layers (Select tool only).
        if (
          tool === 'select' &&
          selection.size > 0 &&
          (e.key === 'ArrowLeft' ||
            e.key === 'ArrowRight' ||
            e.key === 'ArrowUp' ||
            e.key === 'ArrowDown')
        ) {
          e.preventDefault()
          const cssToDoc = is2x ? 2 : 1
          const stepCss = e.shiftKey ? 10 : 1
          const step = stepCss * cssToDoc
          let dx = 0
          let dy = 0
          if (e.key === 'ArrowLeft') dx = -step
          else if (e.key === 'ArrowRight') dx = step
          else if (e.key === 'ArrowUp') dy = -step
          else if (e.key === 'ArrowDown') dy = step
          const ids = Array.from(selection)
          commitOffsetChange((current) => {
            const next = { ...current }
            for (const id of ids) {
              const o = next[id] ?? { x: 0, y: 0 }
              next[id] = { x: o.x + dx, y: o.y + dy }
            }
            return next
          })
          return
        }
      }

      // Undo the last action (visibility change OR layer move).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        if (undoLast()) {
          e.preventDefault()
          return
        }
      }

      // Zoom shortcuts (fallback — main process menu accelerators are primary)
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault()
          zoomIn()
          return
        }
        if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault()
          zoomOut()
          return
        }
        if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault()
          zoom100()
          return
        }
        if (e.key === '1' || e.code === 'Digit1' || e.code === 'Numpad1') {
          e.preventDefault()
          zoomFit()
          return
        }
        if (e.key === 'e' || e.key === 'E') {
          e.preventDefault()
          openExport()
          return
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    marquee,
    marqueeFinalized,
    selection,
    selection.size,
    spaceHeld,
    tool,
    is2x,
    zoomIn,
    zoomOut,
    zoom100,
    zoomFit,
    openExport,
    clearMarquee,
    clearSelection,
    undoLast,
    commitOffsetChange,
    eraseMarqueeFromLayer,
    brushSize,
  ])

  const stageWidth = Math.max(0, viewport.width - RULER_THICKNESS)
  const stageHeight = Math.max(0, viewport.height - RULER_THICKNESS)

  return (
    <div className="app">
      <Toolbar
        doc={doc}
        busy={busy}
        selectionCount={selection.size}
        totalLeafCount={doc?.parsed.totalLeafCount ?? 0}
        onOpen={openPsd}
        onExport={openExport}
      />
      <UpdateBanner />
      {error && <div className="banner error">{error}</div>}
      {compatWarning && <div className="banner warning">{compatWarning}</div>}
      <main className="workspace">
        <ToolPalette
          tool={tool}
          onTool={setTool}
          grid={grid}
          onGrid={setGrid}
          brushSize={brushSize}
          onBrushSize={setBrushSize}
          scale={view.scale}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomFit={zoomFit}
          onZoom100={zoom100}
        />
        <section className="viewport" ref={viewportRef}>
          {doc ? (
            <>
              <div
                className="stage-container"
                style={{ left: RULER_THICKNESS, top: RULER_THICKNESS, width: stageWidth, height: stageHeight }}
              >
                <Canvas
                  doc={doc.parsed}
                  visibility={visibility}
                  offsets={offsets}
                  selection={selection}
                  view={view}
                  onViewChange={setView}
                  tool={tool}
                  spaceHeld={spaceHeld}
                  marquee={marquee}
                  onMarqueeChange={handleMarqueeChange}
                  grid={grid}
                  guides={guides}
                  draggingGuide={draggingGuide}
                  onGuideMouseDown={onGuideMouseDown}
                  onCanvasSoloLayer={onCanvasSelectLayer}
                  hitTestLayer={hitTestLayer}
                  onSelectLayer={selectLayerById}
                  onToggleSelectLayer={toggleSelectLayer}
                  onClearSelection={clearSelection}
                  onBeginLayerDrag={beginLayerDrag}
                  onUpdateLayerDrag={updateLayerDrag}
                  onEndLayerDrag={endLayerDrag}
                  editedCanvases={editedCanvasesRef.current}
                  bitmapVersions={bitmapVersions}
                  brushSize={brushSize}
                  onEraseStrokeBegin={eraseStrokeBegin}
                  onEraseStrokeDot={eraseStrokeDot}
                  onEraseStrokeSegment={eraseStrokeSegment}
                  viewportWidth={stageWidth}
                  viewportHeight={stageHeight}
                  onMousePos={setMousePos}
                />
              </div>
              <Rulers
                view={view}
                viewportWidth={viewport.width}
                viewportHeight={viewport.height}
                docWidth={doc.parsed.width}
                docHeight={doc.parsed.height}
                is2x={is2x}
                mousePos={mousePos}
                onGuideDragStart={onGuideDragStartFromRuler}
              />
              {marqueeFinalized && marquee && (
                <MarqueePanel
                  rect={marquee}
                  docWidth={doc.parsed.width}
                  docHeight={doc.parsed.height}
                  is2x={is2x}
                  onClear={clearMarquee}
                  onSaveAsRule={saveMarqueeAsRule}
                />
              )}
              {guides.length > 0 && (
                <GuidesPanel
                  guides={guides}
                  docWidth={doc.parsed.width}
                  docHeight={doc.parsed.height}
                  is2x={is2x}
                  onClear={clearGuides}
                  onSaveIntersectionAsRule={saveGuideIntersectionAsRule}
                />
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-glyph">
                <CrosshairIcon size={56} />
              </div>
              <h2>Open a PSD to begin</h2>
              <p>
                Open a Photoshop file in Loupe to inspect layers, measure positions, and export
                pieces as PNG or JPG.
              </p>
              <button className="btn primary large" onClick={openPsd} disabled={busy}>
                {busy ? 'Opening…' : 'Open PSD'}
              </button>
              <p className="hint">or press ⌘O</p>
            </div>
          )}
        </section>
        {doc && (
          <aside className="sidebar">
            {rules.length > 0 && (
              <RulesPanel
                rules={rules}
                docWidth={doc.parsed.width}
                docHeight={doc.parsed.height}
                is2x={is2x}
                focusRuleId={focusRuleId}
                onRename={renameRule}
                onDelete={deleteRule}
                onFocused={() => setFocusRuleId(null)}
              />
            )}
            <LayersPanel
              layers={doc.parsed.layers}
              visibility={visibility}
              selection={selection}
              collapsedGroups={collapsedGroups}
              onToggleVisibility={toggleVisibility}
              onSelect={onSelect}
              onClearSelection={clearSelection}
              onToggleCollapsedGroup={toggleCollapsedGroup}
              onSoloLayer={onCanvasSelectLayer}
              isModKeyHeld={isModKeyHeld}
              onShowAll={showAllLayers}
            />
          </aside>
        )}
      </main>
      {doc && (
        <StatusBar
          tool={tool}
          spaceHeld={spaceHeld}
          scale={view.scale}
          mousePos={mousePos}
          is2x={is2x}
          marquee={marquee}
        />
      )}
      {exportOpen && doc && (
        <ExportModal
          layers={exportLayers}
          baseName={basenameNoExt(doc.filePath)}
          is2x={is2x}
          editedCanvases={editedCanvasesRef.current}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}

export default App
