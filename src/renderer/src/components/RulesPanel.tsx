import { useEffect, useRef, useState } from 'react'
import type { Rule } from '../types'
import { CloseIcon } from './icons'

interface RulesPanelProps {
  rules: Rule[]
  docWidth: number
  docHeight: number
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
  is2x: boolean
  autoFocus: boolean
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onAutoFocused: () => void
}

function summary(rule: Rule, is2x: boolean): string {
  const s = is2x ? 0.5 : 1
  if (rule.kind === 'marquee' && rule.rect) {
    const r = rule.rect
    return `${round(r.width * s)} × ${round(r.height * s)} @ (${round(r.x * s)}, ${round(r.y * s)})`
  }
  if (rule.kind === 'guide-intersection' && rule.point) {
    return `(${round(rule.point.x * s)}, ${round(rule.point.y * s)})`
  }
  return ''
}

function copyText(rule: Rule, is2x: boolean): string {
  const s = is2x ? 0.5 : 1
  if (rule.kind === 'marquee' && rule.rect) {
    const r = rule.rect
    return `left: ${round(r.x * s)}px;\ntop: ${round(r.y * s)}px;\nwidth: ${round(r.width * s)}px;\nheight: ${round(r.height * s)}px;`
  }
  if (rule.kind === 'guide-intersection' && rule.point) {
    return `transform-origin: ${round(rule.point.x * s)}px ${round(rule.point.y * s)}px;`
  }
  return ''
}

function RuleRow({ rule, is2x, autoFocus, onRename, onDelete, onAutoFocused }: RuleRowProps) {
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

  async function doCopy() {
    try {
      await navigator.clipboard.writeText(copyText(rule, is2x))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  const displayName = rule.name.trim() || 'Untitled'

  return (
    <div className="rule-row">
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
      <div className="rule-summary">{summary(rule, is2x)}</div>
      <button className="rule-copy" onClick={doCopy}>
        {copied ? 'Copied' : 'Copy CSS'}
      </button>
    </div>
  )
}

export function RulesPanel({
  rules,
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
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            is2x={is2x}
            autoFocus={rule.id === focusRuleId}
            onRename={onRename}
            onDelete={onDelete}
            onAutoFocused={onFocused}
          />
        ))}
      </div>
    </div>
  )
}
