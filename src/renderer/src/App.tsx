import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from './components/Canvas'
import { LayersPanel } from './components/LayersPanel'
import { Toolbar } from './components/Toolbar'
import { ToolPalette } from './components/ToolPalette'
import { Rulers, RULER_THICKNESS } from './components/Rulers'
import { MarqueePanel } from './components/MarqueePanel'
import { GuidesPanel } from './components/GuidesPanel'
import { RulesPanel } from './components/RulesPanel'
import { UpdateBanner } from './components/UpdateBanner'
import { StatusBar } from './components/StatusBar'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { ShortcutsModal } from './components/ShortcutsModal'
import { WelcomeModal } from './components/WelcomeModal'
import { SaveAsModal } from './components/SaveAsModal'
import { TabBar, type TabInfo } from './components/TabBar'
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
  CropRect,
  DisplayBounds,
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
  bitmapVersions: Record<string, number>
}

interface HistoryEntry {
  snapshot: DocStateSnapshot
  bitmapPrev?: { layerId: string; imageData: ImageData }
  cropPrev?: CropRect | null
}

/**
 * One open document, with all of its per-doc state. Lives in the tabs[]
 * array on App. Switching tabs is just changing which one is active.
 */
interface Tab {
  id: string
  doc: OpenedDocument
  docState: { current: DocStateSnapshot; history: HistoryEntry[] }
  editedCanvases: Map<string, HTMLCanvasElement>
  selection: Set<string>
  anchorId: string | null
  view: ViewState
  cropRect: CropRect | null
  marquee: MarqueeRect | null
  marqueeFinalized: boolean
  mousePos: { x: number; y: number } | null
  guides: Guide[]
  rules: Rule[]
  focusRuleId: string | null
  collapsedGroups: Set<string>
  /** Cache for the fit-to-window layout effect — see `useLayoutEffect`. */
  lastFitKey: string
}

const HISTORY_MAX = 50

function makeTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function makeTab(doc: OpenedDocument): Tab {
  return {
    id: makeTabId(),
    doc,
    docState: {
      current: {
        visibility: collectInitialVisibility(doc.parsed.layers),
        offsets: {},
        bitmapVersions: {},
      },
      history: [],
    },
    editedCanvases: new Map(),
    selection: new Set(),
    anchorId: null,
    view: { scale: 1, offsetX: 0, offsetY: 0 },
    cropRect: null,
    marquee: null,
    marqueeFinalized: false,
    mousePos: null,
    guides: [],
    rules: [],
    focusRuleId: null,
    collapsedGroups: new Set(),
    lastFitKey: '',
  }
}

function pushEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return history.length >= HISTORY_MAX
    ? [...history.slice(1), entry]
    : [...history, entry]
}

function basenameNoExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p
  return base.replace(/\.(psd|png|jpe?g)$/i, '')
}

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

// Stable empty references so derived values don't churn between renders when
// there's no active tab.
const EMPTY_VISIBILITY: Record<string, boolean> = {}
const EMPTY_OFFSETS: Record<string, LayerOffset> = {}
const EMPTY_VERSIONS: Record<string, number> = {}
const EMPTY_SELECTION: Set<string> = new Set()
const EMPTY_COLLAPSED: Set<string> = new Set()
const EMPTY_GUIDES: Guide[] = []
const EMPTY_RULES: Rule[] = []
const EMPTY_CANVASES: Map<string, HTMLCanvasElement> = new Map()
const DEFAULT_VIEW: ViewState = { scale: 1, offsetX: 0, offsetY: 0 }

function App(): React.JSX.Element {
  // ============ Tab state ============
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  )

  const updateActiveTab = useCallback(
    (mutator: (t: Tab) => Tab) => {
      setTabs((ts) => ts.map((t) => (t.id === activeTabId ? mutator(t) : t)))
    },
    [activeTabId],
  )

  const tabInfos = useMemo<TabInfo[]>(
    () => tabs.map((t) => ({ id: t.id, filePath: t.doc.filePath })),
    [tabs],
  )

  // ============ Global UI state ============
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Key includes a version so when the welcome copy changes substantively
  // (e.g. v2 added the bulleted tour) users who dismissed v1 still see it.
  const WELCOME_KEY = 'loupe-welcome-seen-v2'
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) !== 'yes'
    } catch {
      return true
    }
  })
  const dismissWelcome = useCallback(() => {
    try {
      localStorage.setItem(WELCOME_KEY, 'yes')
    } catch {
      /* private-mode or quota errors — fine, just close */
    }
    setWelcomeOpen(false)
  }, [])

  const [tool, setTool] = useState<Tool>('select')
  const [brushSize, setBrushSize] = useState<number>(40)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const modKeyHeldRef = useRef(false)
  const [grid, setGrid] = useState<GridConfig>({ enabled: false, spacing: 50 })
  const [draggingGuide, setDraggingGuide] = useState<DraggingGuide | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    layerId: string | null
    layerName: string | null
  } | null>(null)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 800, height: 600 })

  // ============ Derived per-tab state (read-only views into activeTab) ============
  const doc = activeTab?.doc ?? null
  const docState = activeTab?.docState
  const visibility = docState?.current.visibility ?? EMPTY_VISIBILITY
  const offsets = docState?.current.offsets ?? EMPTY_OFFSETS
  const bitmapVersions = docState?.current.bitmapVersions ?? EMPTY_VERSIONS
  const selection = activeTab?.selection ?? EMPTY_SELECTION
  const anchorId = activeTab?.anchorId ?? null
  const view = activeTab?.view ?? DEFAULT_VIEW
  const cropRect = activeTab?.cropRect ?? null
  const marquee = activeTab?.marquee ?? null
  const marqueeFinalized = activeTab?.marqueeFinalized ?? false
  const mousePos = activeTab?.mousePos ?? null
  const guides = activeTab?.guides ?? EMPTY_GUIDES
  const rules = activeTab?.rules ?? EMPTY_RULES
  const focusRuleId = activeTab?.focusRuleId ?? null
  const collapsedGroups = activeTab?.collapsedGroups ?? EMPTY_COLLAPSED

  const displayBounds = useMemo<DisplayBounds>(
    () => cropRect ?? { x: 0, y: 0, w: doc?.parsed.width ?? 0, h: doc?.parsed.height ?? 0 },
    [cropRect, doc?.parsed.width, doc?.parsed.height],
  )

  // Active tab's editedCanvases mirrored via ref so synchronous handlers
  // (eraser strokes, alpha hit-test) always see the right Map.
  const editedCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(EMPTY_CANVASES)
  useEffect(() => {
    editedCanvasesRef.current = activeTab?.editedCanvases ?? EMPTY_CANVASES
  }, [activeTab?.editedCanvases])

  // Refs for global drag handlers (guide drag is registered once on
  // mousedown and reads these on every mousemove).
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const displayBoundsRef = useRef(displayBounds)
  useEffect(() => {
    displayBoundsRef.current = displayBounds
  }, [displayBounds])

  const dragBaselineRef = useRef<{
    ids: string[]
    baseline: Record<string, LayerOffset>
  } | null>(null)

  // ============ Per-tab setters (wrap React setState semantics into
  //             updateActiveTab calls so existing callbacks keep working). ============

  const setDocState = useCallback(
    (value: Tab['docState'] | ((prev: Tab['docState']) => Tab['docState'])) => {
      updateActiveTab((t) => ({
        ...t,
        docState: typeof value === 'function' ? value(t.docState) : value,
      }))
    },
    [updateActiveTab],
  )

  const setSelection = useCallback(
    (value: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      updateActiveTab((t) => ({
        ...t,
        selection: typeof value === 'function' ? value(t.selection) : value,
      }))
    },
    [updateActiveTab],
  )

  const setAnchorId = useCallback(
    (value: string | null) => {
      updateActiveTab((t) => ({ ...t, anchorId: value }))
    },
    [updateActiveTab],
  )

  const setView = useCallback(
    (value: ViewState | ((prev: ViewState) => ViewState)) => {
      updateActiveTab((t) => ({
        ...t,
        view: typeof value === 'function' ? value(t.view) : value,
      }))
    },
    [updateActiveTab],
  )

  const setCropRect = useCallback(
    (value: CropRect | null | ((prev: CropRect | null) => CropRect | null)) => {
      updateActiveTab((t) => ({
        ...t,
        cropRect: typeof value === 'function' ? value(t.cropRect) : value,
      }))
    },
    [updateActiveTab],
  )

  const setMarquee = useCallback(
    (value: MarqueeRect | null | ((prev: MarqueeRect | null) => MarqueeRect | null)) => {
      updateActiveTab((t) => ({
        ...t,
        marquee: typeof value === 'function' ? value(t.marquee) : value,
      }))
    },
    [updateActiveTab],
  )

  const setMarqueeFinalized = useCallback(
    (value: boolean) => {
      updateActiveTab((t) => ({ ...t, marqueeFinalized: value }))
    },
    [updateActiveTab],
  )

  const setMousePos = useCallback(
    (value: { x: number; y: number } | null) => {
      updateActiveTab((t) => ({ ...t, mousePos: value }))
    },
    [updateActiveTab],
  )

  const setGuides = useCallback(
    (value: Guide[] | ((prev: Guide[]) => Guide[])) => {
      updateActiveTab((t) => ({
        ...t,
        guides: typeof value === 'function' ? value(t.guides) : value,
      }))
    },
    [updateActiveTab],
  )

  const setRules = useCallback(
    (value: Rule[] | ((prev: Rule[]) => Rule[])) => {
      updateActiveTab((t) => ({
        ...t,
        rules: typeof value === 'function' ? value(t.rules) : value,
      }))
    },
    [updateActiveTab],
  )

  const setFocusRuleId = useCallback(
    (value: string | null) => {
      updateActiveTab((t) => ({ ...t, focusRuleId: value }))
    },
    [updateActiveTab],
  )

  const setCollapsedGroups = useCallback(
    (value: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      updateActiveTab((t) => ({
        ...t,
        collapsedGroups: typeof value === 'function' ? value(t.collapsedGroups) : value,
      }))
    },
    [updateActiveTab],
  )

  // ============ Viewport ResizeObserver ============
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

  // ============ Guide drag (lives on active tab) ============
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
      const db = displayBoundsRef.current
      const docX = (stageX - v.offsetX) / v.scale + db.x
      const docY = (stageY - v.offsetY) / v.scale + db.y
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
        const db = displayBoundsRef.current
        const inDoc =
          orientation === 'vertical'
            ? r.docX >= db.x && r.docX <= db.x + db.w
            : r.docY >= db.y && r.docY <= db.y + db.h
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
    [computeDragInfo, setGuides],
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
    [guides, runGuideDrag, setGuides],
  )

  const clearGuides = useCallback(() => setGuides([]), [setGuides])

  // ============ Rules ============
  function makeRuleId(): string {
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }

  const saveGuideIntersectionAsRule = useCallback(
    (point: { x: number; y: number }) => {
      const id = makeRuleId()
      setRules((rs) => [{ id, name: '', kind: 'guide-intersection', point }, ...rs])
      setFocusRuleId(id)
    },
    [setRules, setFocusRuleId],
  )

  const renameRule = useCallback(
    (id: string, name: string) => {
      setRules((rs) => rs.map((r) => (r.id === id ? { ...r, name } : r)))
    },
    [setRules],
  )

  const deleteRule = useCallback(
    (id: string) => {
      setRules((rs) => rs.filter((r) => r.id !== id))
    },
    [setRules],
  )

  // ============ Fit view ============
  // Per-tab lastFitKey lives on the Tab itself so switching tabs doesn't
  // reset another tab's zoom/pan.
  useLayoutEffect(() => {
    if (!activeTab) return
    const tab = activeTab
    const cropPart = tab.cropRect
      ? `${tab.cropRect.x},${tab.cropRect.y},${tab.cropRect.w},${tab.cropRect.h}`
      : 'none'
    const key = `${tab.doc.filePath}|${viewport.width}|${viewport.height}|${cropPart}`
    if (tab.lastFitKey === key) return
    const db = tab.cropRect ?? {
      x: 0,
      y: 0,
      w: tab.doc.parsed.width,
      h: tab.doc.parsed.height,
    }
    const newView = fitView(
      db.w,
      db.h,
      Math.max(50, viewport.width - RULER_THICKNESS),
      Math.max(50, viewport.height - RULER_THICKNESS),
    )
    updateActiveTab((t) => ({ ...t, view: newView, lastFitKey: key }))
  }, [activeTab, viewport.width, viewport.height, updateActiveTab])

  // ============ Open / switch / close tabs ============
  const openPsd = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Multi-select: the dialog can return many files; each becomes its
      // own tab. The last file selected becomes the active tab. Warming
      // is deferred (see useEffect below) so opening many files at once
      // doesn't kick off a flood of parallel decode work.
      const results = await window.loupe.pickAndParsePsd()
      if (results.length === 0) return
      const newTabs = results.map(makeTab)
      setTabs((ts) => [...ts, ...newTabs])
      setActiveTabId(newTabs[newTabs.length - 1].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy])

  // Background warm: a queue-based serial process that runs to completion
  // regardless of React re-renders. Each tab is enqueued exactly once and
  // marked warmed only AFTER the async decodes succeed — so cancellation
  // mid-warm doesn't leave an empty editedCanvases Map flagged as warmed
  // (which would silently break the eraser).
  const warmedTabsRef = useRef<Set<string>>(new Set())
  const warmQueueRef = useRef<Tab[]>([])
  const warmingRunningRef = useRef(false)

  const enqueueWarm = useCallback((tab: Tab) => {
    if (warmedTabsRef.current.has(tab.id)) return
    if (warmQueueRef.current.some((t) => t.id === tab.id)) return
    warmQueueRef.current.push(tab)
    if (warmingRunningRef.current) return
    warmingRunningRef.current = true
    void (async () => {
      while (warmQueueRef.current.length > 0) {
        const t = warmQueueRef.current.shift()!
        if (warmedTabsRef.current.has(t.id)) continue
        try {
          await warmAlphaCache(t.doc.parsed.layers)
          await warmEditableCanvases(t.doc.parsed.layers, t.editedCanvases)
          warmedTabsRef.current.add(t.id)
        } catch {
          /* skip; the layer just won't be alpha-tested / erasable */
        }
      }
      warmingRunningRef.current = false
    })()
  }, [])

  // Active tab gets enqueued first (queue dedupes existing entries), then
  // any remaining tabs. Re-runs are cheap — already-warmed and already-
  // queued tabs are skipped.
  useEffect(() => {
    if (activeTab) enqueueWarm(activeTab)
    for (const t of tabs) {
      if (!activeTab || t.id !== activeTab.id) enqueueWarm(t)
    }
  }, [tabs, activeTab, enqueueWarm])

  useEffect(() => {
    return window.loupe.onMenuOpenPsd(() => {
      openPsd()
    })
  }, [openPsd])

  // Window title reflects the active tab's filename, so the macOS App
  // Switcher and Window menu show what you're working on.
  useEffect(() => {
    if (activeTab) {
      const name = activeTab.doc.filePath.split(/[\\/]/).pop() ?? 'Loupe'
      document.title = `${name} — Loupe`
    } else {
      document.title = 'Loupe'
    }
  }, [activeTab?.doc.filePath])

  const switchTab = useCallback((id: string) => {
    setActiveTabId(id)
  }, [])

  const closeTab = useCallback(
    (tabId: string) => {
      warmedTabsRef.current.delete(tabId)
      setTabs((ts) => ts.filter((t) => t.id !== tabId))
      setActiveTabId((current) => {
        if (current !== tabId) return current
        const idx = tabs.findIndex((t) => t.id === tabId)
        return tabs[idx + 1]?.id ?? tabs[idx - 1]?.id ?? null
      })
    },
    [tabs],
  )

  // ============ Selection / visibility / offsets / undo ============
  const toggleCollapsedGroup = useCallback(
    (id: string) => {
      setCollapsedGroups((s) => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [setCollapsedGroups],
  )

  const expandGroups = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      setCollapsedGroups((s) => {
        let next: Set<string> | null = null
        for (const id of ids) {
          if (s.has(id)) {
            if (!next) next = new Set(s)
            next.delete(id)
          }
        }
        return next ?? s
      })
    },
    [setCollapsedGroups],
  )

  const leafOrder = useMemo(() => (doc ? flatLeafOrder(doc.parsed.layers) : []), [doc])

  const onSelect = useCallback(
    (id: string, opts: { meta: boolean; shift: boolean }) => {
      const result = applyClick(selection, anchorId, id, leafOrder, opts)
      setSelection(result.selection)
      setAnchorId(result.anchor)
    },
    [selection, anchorId, leafOrder, setSelection, setAnchorId],
  )

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
    [setDocState],
  )

  const updateOffsetsLive = useCallback(
    (nextFor: (current: Record<string, LayerOffset>) => Record<string, LayerOffset>) => {
      setDocState((s) => ({
        current: { ...s.current, offsets: nextFor(s.current.offsets) },
        history: s.history,
      }))
    },
    [setDocState],
  )

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
    [setDocState],
  )

  const beginBitmapEdit = useCallback(
    (layerId: string) => {
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
    },
    [setDocState],
  )

  const bumpBitmapVersion = useCallback(
    (layerId: string) => {
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
    },
    [setDocState],
  )

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

  const selectLayerById = useCallback(
    (id: string) => {
      setSelection(new Set([id]))
      setAnchorId(id)
    },
    [setSelection, setAnchorId],
  )

  const toggleSelectLayer = useCallback(
    (id: string) => {
      setSelection((sel) => {
        const next = new Set(sel)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      setAnchorId(id)
    },
    [setSelection, setAnchorId],
  )

  const beginLayerDrag = useCallback(
    (ids: string[]) => {
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
    },
    [setDocState],
  )

  const updateLayerDrag = useCallback(
    (dx: number, dy: number) => {
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
    },
    [updateOffsetsLive],
  )

  const endLayerDrag = useCallback(() => {
    dragBaselineRef.current = null
  }, [])

  const docToLayerLocal = useCallback(
    (
      layerId: string,
      docX: number,
      docY: number,
    ): { x: number; y: number; canvas: HTMLCanvasElement } | null => {
      if (!doc) return null
      const canvas = editedCanvasesRef.current.get(layerId)
      if (!canvas) return null
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
    [doc, commitVisibilityChange, setSelection, setAnchorId],
  )

  const undoLast = useCallback(() => {
    const tab = activeTab
    if (!tab || tab.docState.history.length === 0) return false
    const entry = tab.docState.history[tab.docState.history.length - 1]
    if (entry.cropPrev !== undefined) {
      setCropRect(entry.cropPrev)
    }
    setDocState((s) => {
      if (s.history.length === 0) return s
      const inner = s.history[s.history.length - 1]
      if (inner.bitmapPrev) {
        const canvas = editedCanvasesRef.current.get(inner.bitmapPrev.layerId)
        if (canvas) restoreCanvas(canvas, inner.bitmapPrev.imageData)
        invalidateAlphaForLayer(inner.bitmapPrev.layerId)
      }
      return { current: inner.snapshot, history: s.history.slice(0, -1) }
    })
    return true
  }, [activeTab, setCropRect, setDocState])

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
  }, [setSelection, setAnchorId])

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

  const handleMarqueeChange = useCallback(
    (next: MarqueeRect | null, finalized: boolean) => {
      setMarquee(next)
      setMarqueeFinalized(finalized && !!next && next.width > 1 && next.height > 1)
    },
    [setMarquee, setMarqueeFinalized],
  )

  const clearMarquee = useCallback(() => {
    setMarquee(null)
    setMarqueeFinalized(false)
  }, [setMarquee, setMarqueeFinalized])

  const takeOutMarquee = useCallback(() => {
    if (!marquee || selection.size !== 1) return
    const [layerId] = Array.from(selection)
    eraseMarqueeFromLayer(layerId, marquee)
    clearMarquee()
  }, [marquee, selection, eraseMarqueeFromLayer, clearMarquee])

  const applyCrop = useCallback(
    (rect: MarqueeRect) => {
      if (rect.width < 1 || rect.height < 1) return
      setDocState((s) => ({
        current: s.current,
        history: pushEntry(s.history, { snapshot: s.current, cropPrev: cropRect }),
      }))
      setCropRect({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })
      setMarquee(null)
      setMarqueeFinalized(false)
    },
    [cropRect, setDocState, setCropRect, setMarquee, setMarqueeFinalized],
  )

  const resetCrop = useCallback(() => {
    if (cropRect === null) return
    setDocState((s) => ({
      current: s.current,
      history: pushEntry(s.history, { snapshot: s.current, cropPrev: cropRect }),
    }))
    setCropRect(null)
  }, [cropRect, setDocState, setCropRect])

  const handleCanvasContextMenu = useCallback(
    (clientX: number, clientY: number, layerId: string | null) => {
      if (!doc) return
      let layerName: string | null = null
      if (layerId) {
        function walk(nodes: LayerNode[]): string | null {
          for (const n of nodes) {
            if (n.id === layerId) return n.name
            if (n.children) {
              const hit = walk(n.children)
              if (hit !== null) return hit
            }
          }
          return null
        }
        layerName = walk(doc.parsed.layers)
      }
      setContextMenu({ x: clientX, y: clientY, layerId, layerName })
    },
    [doc],
  )

  const trimToLayer = useCallback(
    (layerId: string) => {
      if (!doc) return
      const off = offsets[layerId] ?? { x: 0, y: 0 }
      function findNode(nodes: LayerNode[]): LayerNode | null {
        for (const n of nodes) {
          if (n.id === layerId) return n
          if (n.children) {
            const hit = findNode(n.children)
            if (hit) return hit
          }
        }
        return null
      }
      const node = findNode(doc.parsed.layers)
      if (!node) return
      const left = node.bounds.left + off.x
      const top = node.bounds.top + off.y
      const right = node.bounds.right + off.x
      const bottom = node.bounds.bottom + off.y
      const w = Math.max(1, right - left)
      const h = Math.max(1, bottom - top)
      const cx = Math.max(0, Math.floor(left))
      const cy = Math.max(0, Math.floor(top))
      const cw = Math.min(doc.parsed.width - cx, Math.ceil(w))
      const ch = Math.min(doc.parsed.height - cy, Math.ceil(h))
      if (cw <= 0 || ch <= 0) return
      setDocState((s) => {
        const snap = s.current
        return {
          current: {
            ...snap,
            visibility: buildSoloVisibility(doc.parsed.layers, layerId, snap.visibility),
          },
          history: pushEntry(s.history, { snapshot: snap, cropPrev: cropRect }),
        }
      })
      setSelection(new Set([layerId]))
      setAnchorId(layerId)
      setCropRect({ x: cx, y: cy, w: cw, h: ch })
    },
    [doc, offsets, cropRect, setDocState, setSelection, setAnchorId, setCropRect],
  )

  // ============ Zoom helpers ============
  const zoomCenter = useCallback(() => {
    return { x: viewport.width / 2, y: viewport.height / 2 }
  }, [viewport])

  const zoomIn = useCallback(() => {
    const c = zoomCenter()
    setView((v) => zoomAt(v, c.x, c.y, 1.25))
  }, [zoomCenter, setView])

  const zoomOut = useCallback(() => {
    const c = zoomCenter()
    setView((v) => zoomAt(v, c.x, c.y, 1 / 1.25))
  }, [zoomCenter, setView])

  const zoomFit = useCallback(() => {
    if (!doc) return
    setView(
      fitView(
        displayBounds.w,
        displayBounds.h,
        Math.max(50, viewport.width - RULER_THICKNESS),
        Math.max(50, viewport.height - RULER_THICKNESS),
      ),
    )
  }, [doc, viewport, displayBounds.w, displayBounds.h, setView])

  const zoom100 = useCallback(() => {
    const c = zoomCenter()
    setView((v) => setZoom(v, 1, c.x, c.y))
  }, [zoomCenter, setView])

  useEffect(() => {
    if (typeof window.loupe.onCanvasAction !== 'function') return
    return window.loupe.onCanvasAction((action: string) => {
      if (action === 'zoom-in') zoomIn()
      else if (action === 'zoom-out') zoomOut()
      else if (action === 'zoom-100') zoom100()
      else if (action === 'zoom-fit') zoomFit()
    })
  }, [zoomIn, zoomOut, zoom100, zoomFit])

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

      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        if (undoLast()) {
          e.preventDefault()
          return
        }
      }

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
        if (e.key === '/') {
          e.preventDefault()
          setShortcutsOpen((v) => !v)
          return
        }
      }
      if ((e.metaKey || e.ctrlKey || e.altKey) && e.code === 'KeyS' && !e.shiftKey) {
        e.preventDefault()
        if (doc) setSaveAsOpen(true)
        return
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
    clearMarquee,
    clearSelection,
    undoLast,
    commitOffsetChange,
    eraseMarqueeFromLayer,
    brushSize,
    doc,
  ])

  const stageWidth = Math.max(0, viewport.width - RULER_THICKNESS)
  const stageHeight = Math.max(0, viewport.height - RULER_THICKNESS)

  return (
    <div className="app">
      <Toolbar
        doc={doc}
        busy={busy}
        onOpen={openPsd}
        onOpenSave={() => setSaveAsOpen(true)}
        cropRect={cropRect}
        onResetCrop={resetCrop}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <UpdateBanner />
      {error && <div className="banner error">{error}</div>}
      {compatWarning && <div className="banner warning">{compatWarning}</div>}
      <TabBar
        tabs={tabInfos}
        activeTabId={activeTabId}
        busy={busy}
        onSwitch={switchTab}
        onClose={closeTab}
        onOpenNew={openPsd}
      />
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
          {tabs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-glyph">
                <CrosshairIcon size={56} />
              </div>
              <h2>Open a file to begin</h2>
              <p>
                Open a Photoshop (.psd), PNG, or JPG file in Loupe to inspect layers, measure
                positions, and save the canvas.
              </p>
              <button className="btn primary large" onClick={openPsd} disabled={busy}>
                {busy ? 'Opening…' : 'Open file'}
              </button>
              <p className="hint">or press ⌘O</p>
            </div>
          ) : (
            // Render every open tab's viewport content and toggle visibility
            // via CSS. Keeping inactive Konva Stages mounted means tab
            // switching is just a `display: none/block` flip — no
            // unmount-remount of LeafLayers, no Konva scene-tree rebuild,
            // no re-decode of images.
            tabs.map((tab) => {
              const active = tab.id === activeTabId
              const tabBounds = tab.cropRect ?? {
                x: 0,
                y: 0,
                w: tab.doc.parsed.width,
                h: tab.doc.parsed.height,
              }
              const tabIs2x =
                tab.doc.parsed.width % 2 === 0 && tab.doc.parsed.height % 2 === 0
              return (
                <div
                  key={tab.id}
                  className="tab-pane"
                  style={{ display: active ? 'block' : 'none' }}
                >
                  <div
                    className="stage-container"
                    style={{
                      left: RULER_THICKNESS,
                      top: RULER_THICKNESS,
                      width: stageWidth,
                      height: stageHeight,
                    }}
                  >
                    <Canvas
                      doc={tab.doc.parsed}
                      displayBounds={tabBounds}
                      visibility={tab.docState.current.visibility}
                      offsets={tab.docState.current.offsets}
                      selection={tab.selection}
                      view={tab.view}
                      onViewChange={setView}
                      tool={tool}
                      spaceHeld={spaceHeld}
                      marquee={tab.marquee}
                      onMarqueeChange={handleMarqueeChange}
                      grid={grid}
                      guides={tab.guides}
                      draggingGuide={active ? draggingGuide : null}
                      onGuideMouseDown={onGuideMouseDown}
                      onCanvasSoloLayer={onCanvasSelectLayer}
                      hitTestLayer={hitTestLayer}
                      onSelectLayer={selectLayerById}
                      onToggleSelectLayer={toggleSelectLayer}
                      onClearSelection={clearSelection}
                      onBeginLayerDrag={beginLayerDrag}
                      onUpdateLayerDrag={updateLayerDrag}
                      onEndLayerDrag={endLayerDrag}
                      editedCanvases={tab.editedCanvases}
                      bitmapVersions={tab.docState.current.bitmapVersions}
                      brushSize={brushSize}
                      onEraseStrokeBegin={eraseStrokeBegin}
                      onEraseStrokeDot={eraseStrokeDot}
                      onEraseStrokeSegment={eraseStrokeSegment}
                      viewportWidth={stageWidth}
                      viewportHeight={stageHeight}
                      onMousePos={setMousePos}
                      onContextMenu={handleCanvasContextMenu}
                    />
                  </div>
                  <Rulers
                    view={tab.view}
                    viewportWidth={viewport.width}
                    viewportHeight={viewport.height}
                    displayBounds={tabBounds}
                    is2x={tabIs2x}
                    mousePos={tab.mousePos}
                    onGuideDragStart={onGuideDragStartFromRuler}
                  />
                  {tab.marqueeFinalized && tab.marquee && (
                    <MarqueePanel
                      rect={tab.marquee}
                      displayBounds={tabBounds}
                      is2x={tabIs2x}
                      onClear={clearMarquee}
                      onApplyCrop={applyCrop}
                      onTakeOut={takeOutMarquee}
                      canTakeOut={tab.selection.size === 1}
                    />
                  )}
                  {tab.guides.length > 0 && (
                    <GuidesPanel
                      guides={tab.guides}
                      displayBounds={tabBounds}
                      is2x={tabIs2x}
                      onClear={clearGuides}
                      onSaveIntersectionAsRule={saveGuideIntersectionAsRule}
                    />
                  )}
                </div>
              )
            })
          )}
        </section>
        {doc && (
          <aside className="sidebar">
            <RulesPanel
              rules={rules}
              displayBounds={displayBounds}
              is2x={is2x}
              focusRuleId={focusRuleId}
              onRename={renameRule}
              onDelete={deleteRule}
              onFocused={() => setFocusRuleId(null)}
            />
            <LayersPanel
              layers={doc.parsed.layers}
              visibility={visibility}
              selection={selection}
              collapsedGroups={collapsedGroups}
              onToggleVisibility={toggleVisibility}
              onSelect={onSelect}
              onClearSelection={clearSelection}
              onToggleCollapsedGroup={toggleCollapsedGroup}
              onExpandGroups={expandGroups}
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
          displayBounds={displayBounds}
        />
      )}
      {saveAsOpen && doc && (
        <SaveAsModal
          doc={doc.parsed}
          baseName={basenameNoExt(doc.filePath)}
          visibility={visibility}
          offsets={offsets}
          displayBounds={displayBounds}
          editedCanvases={editedCanvasesRef.current}
          is2x={is2x}
          onClose={() => setSaveAsOpen(false)}
        />
      )}
      {welcomeOpen && <WelcomeModal onClose={dismissWelcome} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {contextMenu && contextMenu.layerId && contextMenu.layerName && (() => {
        const layerId = contextMenu.layerId
        const items: ContextMenuItem[] = [
          {
            label: `Trim to "${contextMenu.layerName}"`,
            onClick: () => trimToLayer(layerId),
          },
        ]
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={items}
            onClose={() => setContextMenu(null)}
          />
        )
      })()}
    </div>
  )
}

export default App
