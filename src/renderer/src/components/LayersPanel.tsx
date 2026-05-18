import { useEffect, useRef } from 'react'
import type { LayerNode } from '../types'
import { blobUrlFor } from '../lib/blob-url'
import { ChevronDownIcon, ChevronRightIcon, EyeOffIcon, EyeOnIcon, FolderIcon } from './icons'

interface LayersPanelProps {
  layers: LayerNode[]
  visibility: Record<string, boolean>
  selection: Set<string>
  collapsedGroups: Set<string>
  onToggleVisibility: (id: string) => void
  onSelect: (id: string, opts: { meta: boolean; shift: boolean }) => void
  onClearSelection: () => void
  onToggleCollapsedGroup: (id: string) => void
  /**
   * Un-collapse the given group ids in a single state update. Used when
   * auto-revealing a layer that lives inside collapsed parents.
   */
  onExpandGroups: (ids: string[]) => void
  onSoloLayer: (id: string) => void
  isModKeyHeld: () => boolean
  onShowAll: () => void
}

/**
 * Walk the layer tree and return the ids of every group that contains the
 * target leaf (root → leaf order). Empty array if not found.
 */
function findAncestorGroupIds(layers: LayerNode[], targetId: string): string[] {
  const path: string[] = []
  function walk(nodes: LayerNode[], parents: string[]): boolean {
    for (const n of nodes) {
      if (n.id === targetId) {
        path.push(...parents)
        return true
      }
      if (n.children && walk(n.children, [...parents, n.id])) return true
    }
    return false
  }
  walk(layers, [])
  return path
}

interface LayerRowProps {
  node: LayerNode
  depth: number
  visibility: Record<string, boolean>
  selection: Set<string>
  collapsedGroups: Set<string>
  onToggleVisibility: (id: string) => void
  onSelect: (id: string, opts: { meta: boolean; shift: boolean }) => void
  onToggleCollapsedGroup: (id: string) => void
  onSoloLayer: (id: string) => void
  isModKeyHeld: () => boolean
}

function flagPills(node: LayerNode): string[] {
  const out: string[] = []
  if (node.flags.text) out.push('T')
  if (node.flags.mask) out.push('M')
  if (node.flags.clipping) out.push('C')
  if (node.flags.smartObject) out.push('SO')
  if (node.flags.adjustment) out.push('A')
  if (node.flags.effects) out.push('FX')
  return out
}

function LayerRow({
  node,
  depth,
  visibility,
  selection,
  collapsedGroups,
  onToggleVisibility,
  onSelect,
  onToggleCollapsedGroup,
  onSoloLayer,
  isModKeyHeld,
}: LayerRowProps) {
  const visible = visibility[node.id] ?? node.visible
  const isGroup = node.kind === 'group'
  const isSelected = selection.has(node.id)
  const isCollapsed = isGroup && collapsedGroups.has(node.id)

  return (
    <>
      <div
        className={`layer-row${isSelected ? ' selected' : ''}`}
        data-layer-id={node.id}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={(e) => {
          if (isGroup) return
          onSelect(node.id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })
        }}
      >
        <button
          className="eye"
          aria-label={visible ? 'Hide layer' : 'Show layer'}
          title="Click: toggle · ⌘/Alt+click: solo"
          onClick={(e) => {
            e.stopPropagation()
            const wantsSolo =
              e.metaKey || e.altKey || e.ctrlKey || isModKeyHeld()
            if (wantsSolo) {
              onSoloLayer(node.id)
            } else {
              onToggleVisibility(node.id)
            }
          }}
        >
          {visible ? <EyeOnIcon size={14} /> : <EyeOffIcon size={14} />}
        </button>
        <div className="thumb">
          {isGroup ? (
            <span className="group-folder">
              <FolderIcon size={14} />
            </span>
          ) : node.thumbnail ? (
            <img src={blobUrlFor(node.thumbnail)} alt="" />
          ) : (
            <span className="empty-thumb" />
          )}
        </div>
        <div className={`name${visible ? '' : ' dim'}`} title={node.name}>
          {node.name}
        </div>
        <div className="pills">
          {flagPills(node).map((p) => (
            <span key={p} className="pill">
              {p}
            </span>
          ))}
        </div>
        {isGroup && (
          <button
            className="group-chevron-right"
            aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
            title={isCollapsed ? 'Expand group' : 'Collapse group'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapsedGroup(node.id)
            }}
          >
            {isCollapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
          </button>
        )}
      </div>
      {isGroup &&
        !isCollapsed &&
        (node.children ?? []).map((child) => (
          <LayerRow
            key={child.id}
            node={child}
            depth={depth + 1}
            visibility={visibility}
            selection={selection}
            collapsedGroups={collapsedGroups}
            onToggleVisibility={onToggleVisibility}
            onSelect={onSelect}
            onToggleCollapsedGroup={onToggleCollapsedGroup}
            onSoloLayer={onSoloLayer}
            isModKeyHeld={isModKeyHeld}
          />
        ))}
    </>
  )
}

export function LayersPanel({
  layers,
  visibility,
  selection,
  collapsedGroups,
  onToggleVisibility,
  onSelect,
  onClearSelection,
  onToggleCollapsedGroup,
  onExpandGroups,
  onSoloLayer,
  isModKeyHeld,
  onShowAll,
}: LayersPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // When a single layer is selected (e.g. via canvas click, ⌘+click solo,
  // or Trim), reveal its row in the panel: un-collapse any ancestor groups
  // it's hidden inside, then scroll its row into view. `block: 'nearest'`
  // keeps the row in place if it's already visible.
  useEffect(() => {
    if (selection.size !== 1) return
    const layerId = Array.from(selection)[0]
    const ancestors = findAncestorGroupIds(layers, layerId)
    const collapsed = ancestors.filter((id) => collapsedGroups.has(id))
    if (collapsed.length > 0) {
      onExpandGroups(collapsed)
    }
    // Run after the next render so any just-expanded rows are mounted.
    const raf = requestAnimationFrame(() => {
      const row = scrollRef.current?.querySelector<HTMLElement>(
        `[data-layer-id="${CSS.escape(layerId)}"]`,
      )
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [selection, layers, collapsedGroups, onExpandGroups])

  return (
    <div className="layers-panel">
      <div className="panel-header">
        <span>Layers</span>
        <div className="panel-header-actions">
          <button className="link-btn" onClick={onShowAll} title="Show all layers">
            Show all
          </button>
          {selection.size > 0 && (
            <button className="link-btn" onClick={onClearSelection}>
              Clear ({selection.size})
            </button>
          )}
        </div>
      </div>
      <div className="layers-hint">
        Click eye to toggle · <kbd>⌘</kbd>-click to solo · right-click for more
      </div>
      <div className="layers-scroll" ref={scrollRef} onClick={(e) => e.stopPropagation()}>
        {layers.map((node) => (
          <LayerRow
            key={node.id}
            node={node}
            depth={0}
            visibility={visibility}
            selection={selection}
            collapsedGroups={collapsedGroups}
            onToggleVisibility={onToggleVisibility}
            onSelect={onSelect}
            onToggleCollapsedGroup={onToggleCollapsedGroup}
            onSoloLayer={onSoloLayer}
            isModKeyHeld={isModKeyHeld}
          />
        ))}
      </div>
    </div>
  )
}
