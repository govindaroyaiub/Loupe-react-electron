import type { MouseEvent } from 'react'
import { CloseIcon, PlusIcon } from './icons'

export interface TabInfo {
  id: string
  filePath: string
}

interface Props {
  tabs: TabInfo[]
  activeTabId: string | null
  busy: boolean
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onOpenNew: () => void
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function TabBar({ tabs, activeTabId, busy, onSwitch, onClose, onOpenNew }: Props) {
  if (tabs.length === 0) return null

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const name = basename(tab.filePath)
        const onAux = (e: MouseEvent) => {
          // Middle-click closes the tab (Chrome convention).
          if (e.button === 1) {
            e.preventDefault()
            onClose(tab.id)
          }
        }
        return (
          <div
            key={tab.id}
            className={`tab${active ? ' active' : ''}`}
            role="tab"
            aria-selected={active}
            title={tab.filePath}
            onClick={() => onSwitch(tab.id)}
            onAuxClick={onAux}
          >
            <span className="tab-name">{name}</span>
            <button
              className="tab-close"
              aria-label={`Close ${name}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        )
      })}
      <button
        className="tab-add"
        onClick={onOpenNew}
        disabled={busy}
        title="Open another file (⌘O)"
        aria-label="Open another file"
      >
        <PlusIcon size={14} />
      </button>
    </div>
  )
}
