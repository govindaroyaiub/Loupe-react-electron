import type { LayerNode } from '../types'
import { blobUrlFor } from '../lib/blob-url'

interface LayersPanelProps {
  layers: LayerNode[]
  visibility: Record<string, boolean>
  selection: Set<string>
  collapsedGroups: Set<string>
  onToggleVisibility: (id: string) => void
  onSelect: (id: string, opts: { meta: boolean; shift: boolean }) => void
  onClearSelection: () => void
  onToggleCollapsedGroup: (id: string) => void
  onSoloLayer: (id: string) => void
  isModKeyHeld: () => boolean
  onShowAll: () => void
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
        style={{ paddingLeft: 8 + depth * 14 }}
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
          {visible ? '●' : '○'}
        </button>
        <div className="thumb">
          {isGroup ? (
            <span className="group-folder">▦</span>
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
            {isCollapsed ? '▸' : '▾'}
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
  onSoloLayer,
  isModKeyHeld,
  onShowAll,
}: LayersPanelProps) {
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
      <div className="layers-scroll" onClick={(e) => e.stopPropagation()}>
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
