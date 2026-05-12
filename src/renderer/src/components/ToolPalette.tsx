import type { GridConfig, Tool } from '../types'

interface ToolPaletteProps {
  tool: Tool
  onTool: (t: Tool) => void
  grid: GridConfig
  onGrid: (g: GridConfig) => void
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomFit: () => void
  onZoom100: () => void
}

const TOOLS: { id: Tool; label: string; shortcut: string; glyph: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', glyph: '⬉' },
  { id: 'marquee', label: 'Marquee', shortcut: 'M', glyph: '▭' },
  { id: 'hand', label: 'Hand (Space)', shortcut: 'H', glyph: '✋' },
]

export function ToolPalette({
  tool,
  onTool,
  grid,
  onGrid,
  scale,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onZoom100,
}: ToolPaletteProps) {
  return (
    <div className="tool-palette">
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn${tool === t.id ? ' active' : ''}`}
            title={`${t.label} (${t.shortcut})`}
            onClick={() => onTool(t.id)}
          >
            <span className="glyph">{t.glyph}</span>
            <span className="kbd">{t.shortcut}</span>
          </button>
        ))}
      </div>

      <div className="tool-divider" />

      <div className="tool-group">
        <button
          className={`tool-btn${grid.enabled ? ' active' : ''}`}
          title="Toggle grid (G)"
          onClick={() => onGrid({ ...grid, enabled: !grid.enabled })}
        >
          <span className="glyph">⊞</span>
          <span className="kbd">G</span>
        </button>
        {grid.enabled && (
          <div className="grid-spacing">
            <label>px</label>
            <input
              type="number"
              min={2}
              max={500}
              step={1}
              value={grid.spacing}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v > 0) onGrid({ ...grid, spacing: v })
              }}
            />
          </div>
        )}
      </div>

      <div className="tool-divider" />

      <div className="tool-group">
        <button className="tool-btn" title="Zoom out (⌘-)" onClick={onZoomOut}>
          <span className="glyph">−</span>
        </button>
        <button className="zoom-readout" title="Reset to 100% (⌘0)" onClick={onZoom100}>
          {Math.round(scale * 100)}%
        </button>
        <button className="tool-btn" title="Zoom in (⌘+)" onClick={onZoomIn}>
          <span className="glyph">+</span>
        </button>
        <button className="tool-btn small" title="Fit to screen (⌘1)" onClick={onZoomFit}>
          <span className="small-label">Fit</span>
        </button>
      </div>
    </div>
  )
}
