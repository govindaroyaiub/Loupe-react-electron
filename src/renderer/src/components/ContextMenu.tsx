import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface ContextMenuProps {
  /** Anchor position in viewport coordinates (clientX/Y). */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

const MENU_WIDTH = 220
const MENU_PADDING = 4
const ITEM_HEIGHT = 28

/**
 * Small floating context menu rendered with `position: fixed`. Closes on
 * outside-click or Escape. The caller is responsible for opening it on
 * right-click.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Use capture so we beat any inner stopPropagation handlers.
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  // Clamp position so the menu stays inside the viewport.
  const height = MENU_PADDING * 2 + items.length * ITEM_HEIGHT
  const left = Math.min(Math.max(0, x), window.innerWidth - MENU_WIDTH - 4)
  const top = Math.min(Math.max(0, y), window.innerHeight - height - 4)

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left, top, width: MENU_WIDTH }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          type="button"
          className="context-menu-item"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
