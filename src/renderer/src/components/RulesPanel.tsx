import { useEffect, useRef, useState } from 'react'
import type { DisplayBounds, Rule } from '../types'
import { CloseIcon } from './icons'

interface RulesPanelProps {
  rules: Rule[]
  /**
   * Visible doc bounds. Rules are stored in absolute doc coords; this is
   * used to translate them for display and to dim rules outside the crop.
   */
  displayBounds: DisplayBounds
  is2x: boolean
  focusRuleId: string | null
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onFocused: () => void
}

function round(n: number, digits = 1): number {
  const f = Math.pow(10, digits)
  return Math.round(n * f) / f
}

interface RuleRowProps {
  rule: Rule
  displayBounds: DisplayBounds
  is2x: boolean
  autoFocus: boolean
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onAutoFocused: () => void
}

function isOutsideCrop(rule: Rule, db: DisplayBounds): boolean {
  if (rule.kind === 'marquee' && rule.rect) {
    const r = rule.rect
    return (
      r.x + r.width <= db.x ||
      r.x >= db.x + db.w ||
      r.y + r.height <= db.y ||
      r.y >= db.y + db.h
    )
  }
  if (rule.kind === 'guide-intersection' && rule.point) {
    const p = rule.point
    return p.x < db.x || p.x > db.x + db.w || p.y < db.y || p.y > db.y + db.h
  }
  return false
}

function summary(rule: Rule, is2x: boolean, db: DisplayBounds): string {
  const s = is2x ? 0.5 : 1
  if (rule.kind === 'marquee' && rule.rect) {
    const r = rule.rect
    const lx = r.x - db.x
    const ly = r.y - db.y
    return `${round(r.width * s)} × ${round(r.height * s)} @ (${round(lx * s)}, ${round(ly * s)})`
  }
  if (rule.kind === 'guide-intersection' && rule.point) {
    const lx = rule.point.x - db.x
    const ly = rule.point.y - db.y
    return `(${round(lx * s)}, ${round(ly * s)})`
  }
  return ''
}

function copyText(rule: Rule, is2x: boolean, db: DisplayBounds): string {
  const s = is2x ? 0.5 : 1
  if (rule.kind === 'marquee' && rule.rect) {
    const r = rule.rect
    const lx = r.x - db.x
    const ly = r.y - db.y
    return `left: ${round(lx * s)}px;\ntop: ${round(ly * s)}px;\nwidth: ${round(r.width * s)}px;\nheight: ${round(r.height * s)}px;`
  }
  if (rule.kind === 'guide-intersection' && rule.point) {
    const lx = rule.point.x - db.x
    const ly = rule.point.y - db.y
    return `transform-origin: ${round(lx * s)}px ${round(ly * s)}px;`
  }
  return ''
}

function RuleRow({
  rule,
  displayBounds,
  is2x,
  autoFocus,
  onRename,
  onDelete,
  onAutoFocused,
}: RuleRowProps) {
  const [editing, setEditing] = useState(autoFocus)
  const [draft, setDraft] = useState(rule.name)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
      onAutoFocused()
    }
  }, [autoFocus, onAutoFocused])

  function commit() {
    onRename(rule.id, draft.trim())
    setEditing(false)
  }

  const outside = isOutsideCrop(rule, displayBounds)

  async function doCopy() {
    if (outside) return
    try {
      await navigator.clipboard.writeText(copyText(rule, is2x, displayBounds))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  const displayName = rule.name.trim() || 'Untitled'

  return (
    <div className={`rule-row${outside ? ' outside-crop' : ''}`}>
      <div className="rule-head">
        {editing ? (
          <input
            ref={inputRef}
            className="rule-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setDraft(rule.name)
                setEditing(false)
              }
            }}
            placeholder="Untitled"
          />
        ) : (
          <button
            className={`rule-name${rule.name.trim() ? '' : ' untitled'}`}
            onClick={() => {
              setDraft(rule.name)
              setEditing(true)
            }}
            title="Click to rename"
          >
            {displayName}
          </button>
        )}
        <button className="icon-btn" onClick={() => onDelete(rule.id)} aria-label="Delete rule">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="rule-summary">
        {summary(rule, is2x, displayBounds)}
        {outside && <span className="rule-outside-tag"> · outside crop</span>}
      </div>
      <button className="rule-copy" onClick={doCopy} disabled={outside}>
        {copied ? 'Copied' : 'Copy CSS'}
      </button>
    </div>
  )
}

export function RulesPanel({
  rules,
  displayBounds,
  is2x,
  focusRuleId,
  onRename,
  onDelete,
  onFocused,
}: RulesPanelProps) {
  return (
    <div className="rules-panel">
      <div className="panel-header">
        <span>Rules ({rules.length})</span>
      </div>
      <div className="rules-scroll">
        {rules.length === 0 ? (
          <div className="rules-empty">
            Drag two guides from the rulers, then click <strong>+ Rule</strong> on
            the guides panel to save a measurement here.
          </div>
        ) : (
          rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              displayBounds={displayBounds}
              is2x={is2x}
              autoFocus={rule.id === focusRuleId}
              onRename={onRename}
              onDelete={onDelete}
              onAutoFocused={onFocused}
            />
          ))
        )}
      </div>
    </div>
  )
}
