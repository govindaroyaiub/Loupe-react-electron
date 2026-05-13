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
import { findLayerAtAlpha, warmAlphaCache } from './lib/hit-test'
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
  // Combined state so visibility, layer offsets, and their undo history update atomically.
  const [docState, setDocState] = useState<{
    current: DocStateSnapshot
    history: DocStateSnapshot[]
  }>({ current: { visibility: {}, offsets: {} }, history: [] })
  const visibility = docState.current.visibility
  const offsets = docState.current.offsets
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const [tool, setTool] = useState<Tool>('select')
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
  // clicks are pixel-accurate.
  useEffect(() => {
    if (!doc) return
    warmAlphaCache(doc.parsed.layers).catch(() => {
      /* decode failures fall back to bbox automatically */
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
        setDocState({
          current: { visibility: collectInitialVisibility(result.parsed.layers), offsets: {} },
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

  // Single atomic setState: append the current snapshot to history AND swap in
  // the new visibility in one go. Avoids the nested-setState pitfall.
  const commitVisibilityChange = useCallback(
    (nextFor: (current: Record<string, boolean>) => Record<string, boolean>) => {
      setDocState((s) => {
        const snap = s.current
        const nextHistory =
          s.history.length >= HISTORY_MAX
            ? [...s.history.slice(1), snap]
            : [...s.history, snap]
        return {
          current: { ...snap, visibility: nextFor(snap.visibility) },
          history: nextHistory,
        }
      })
    },
    [],
  )

  // Apply an offset change without pushing history. Used for live drag updates;
  // caller is expected to pushHistory() once at drag start.
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
        const nextHistory =
          s.history.length >= HISTORY_MAX
            ? [...s.history.slice(1), snap]
            : [...s.history, snap]
        return {
          current: { ...snap, offsets: nextFor(snap.offsets) },
          history: nextHistory,
        }
      })
    },
    [],
  )

  // Sync hit-test for the Select tool. Uses the alpha-aware lookup that
  // respects current visibility + per-layer offsets. Falls back to bbox for
  // any layer whose image hasn't decoded yet.
  const hitTestLayer = useCallback(
    (docX: number, docY: number): string | null => {
      if (!doc) return null
      const node = findLayerAtAlpha(doc.parsed.layers, visibility, offsets, docX, docY)
      return node?.id ?? null
    },
    [doc, visibility, offsets],
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
      const nextHistory =
        s.history.length >= HISTORY_MAX
          ? [...s.history.slice(1), s.current]
          : [...s.history, s.current]
      return { current: s.current, history: nextHistory }
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
      const snap = s.history[s.history.length - 1]
      return { current: snap, history: s.history.slice(0, -1) }
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
        if (e.key === 'g' || e.key === 'G') {
          setGrid((g) => ({ ...g, enabled: !g.enabled }))
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
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}

export default App
