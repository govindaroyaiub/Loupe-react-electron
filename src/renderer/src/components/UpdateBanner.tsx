import { useEffect, useState } from 'react'

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version?: string }
  | { kind: 'progress'; percent: number; transferred?: number; total?: number }
  | { kind: 'downloaded'; version?: string }
  | { kind: 'error'; message: string }

interface UpdateInfo {
  version?: string
}

interface ProgressInfo {
  percent?: number
  transferred?: number
  total?: number
}

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window.loupe.onUpdateEvent !== 'function') return
    return window.loupe.onUpdateEvent(({ event, payload }) => {
      if (event === 'checking') setState({ kind: 'checking' })
      else if (event === 'available') {
        const info = payload as UpdateInfo | undefined
        setState({ kind: 'available', version: info?.version })
        setDismissed(false)
      } else if (event === 'not-available') setState({ kind: 'idle' })
      else if (event === 'progress') {
        const p = payload as ProgressInfo | undefined
        setState({
          kind: 'progress',
          percent: Math.round(p?.percent ?? 0),
          transferred: p?.transferred,
          total: p?.total,
        })
      } else if (event === 'downloaded') {
        const info = payload as UpdateInfo | undefined
        setState({ kind: 'downloaded', version: info?.version })
        setDismissed(false)
      } else if (event === 'error') setState({ kind: 'error', message: String(payload) })
    })
  }, [])

  if (state.kind === 'idle' || state.kind === 'checking' || dismissed) return null

  if (state.kind === 'available') {
    return (
      <div className="update-banner info">
        <span>
          Update available{state.version ? ` (v${state.version})` : ''} — downloading in
          background…
        </span>
        <button className="link-btn" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    )
  }

  if (state.kind === 'progress') {
    return (
      <div className="update-banner info">
        <span>Downloading update… {state.percent}%</span>
        <button className="link-btn" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    )
  }

  if (state.kind === 'downloaded') {
    return (
      <div className="update-banner success">
        <span>
          Update ready{state.version ? ` (v${state.version})` : ''} — restart to install.
        </span>
        <button className="btn primary small" onClick={() => window.loupe.installUpdate()}>
          Restart now
        </button>
        <button className="link-btn" onClick={() => setDismissed(true)}>
          Later
        </button>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="update-banner error">
        <span>Update error: {state.message}</span>
        <button className="link-btn" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    )
  }

  return null
}
