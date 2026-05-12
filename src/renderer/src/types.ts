export type LayerKind = 'group' | 'layer'

export interface LayerFlags {
  text: boolean
  mask: boolean
  clipping: boolean
  smartObject: boolean
  adjustment: boolean
  effects: boolean
}

export interface LayerNode {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  opacity: number
  blendMode: string
  bounds: { left: number; top: number; right: number; bottom: number }
  flags: LayerFlags
  thumbnail?: Uint8Array
  image?: Uint8Array
  children?: LayerNode[]
}

export interface ParsedPsd {
  width: number
  height: number
  hasComposite: boolean
  composite?: Uint8Array
  layers: LayerNode[]
  totalLeafCount: number
}

export interface OpenedDocument {
  filePath: string
  parsed: ParsedPsd
}

export type Tool = 'select' | 'marquee' | 'hand'

export interface MarqueeRect {
  /** All values in document (@2x) coordinate space */
  x: number
  y: number
  width: number
  height: number
}

export interface GridConfig {
  enabled: boolean
  /** Spacing in document (@2x) pixels */
  spacing: number
}

export type GuideOrientation = 'vertical' | 'horizontal'

export interface Guide {
  id: string
  orientation: GuideOrientation
  /** Document coord: x for vertical, y for horizontal */
  pos: number
}

export interface DraggingGuide {
  /** Existing guide id if repositioning, undefined if creating new from ruler */
  id?: string
  orientation: GuideOrientation
  /** Current position in document coords */
  pos: number
  /** True if cursor is currently over the ruler area (drop = delete or cancel) */
  overRuler: boolean
}

export type RuleKind = 'marquee' | 'guide-intersection'

export interface Rule {
  id: string
  name: string
  kind: RuleKind
  /** Present when kind === 'marquee' */
  rect?: MarqueeRect
  /** Present when kind === 'guide-intersection' */
  point?: { x: number; y: number }
}
