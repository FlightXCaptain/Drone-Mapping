import { useState } from 'react'
import { usePlanner } from '../store'
import { useProcessingView } from '../processing'
import type { MissionStats } from '../domain/types'

function duration(s: number) {
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.max(1, m)} min`
}

const KIND_LABEL = { map: 'Photogrammetry', splat: 'Splat' } as const

/**
 * After the flight: turn the photos into results (desktop app only). While a job runs it becomes
 * that job's progress bar, so the map stays usable; click it to reopen the processing window.
 */
function ProcessButton({ onClick }: { onClick: () => void }) {
  const job = useProcessingView((s) => s.job)
  const finished = useProcessingView((s) => s.finished)
  if (job)
    return (
      <button className="process-btn process-running" onClick={onClick} title={`${job.name}: ${job.stage}. Click to see details.`}>
        <span className="process-label">
          {KIND_LABEL[job.kind]} · {job.stage} {Math.round(job.pct)}%
        </span>
        <span className="mini-bar" aria-hidden>
          <i style={{ width: `${Math.max(2, job.pct)}%` }} />
        </span>
      </button>
    )
  if (finished)
    return (
      <button className={`process-btn process-${finished.status === 'done' ? 'ready' : 'failed'}`} onClick={onClick}>
        {finished.status === 'done' ? `${KIND_LABEL[finished.kind]} ready: view` : `${KIND_LABEL[finished.kind]} ${finished.status}: see why`}
      </button>
    )
  return (
    <button className="process-btn" onClick={onClick} title="Turn the photos from a flight into a map, 3D model or splat">
      Process photos
    </button>
  )
}

export function StatsBar({ stats, onProcess }: { stats: MissionStats | null; onProcess?: () => void }) {
  const setSendOpen = usePlanner((s) => s.setSendOpen)
  const [showWarnings, setShowWarnings] = useState(false)
  // No plan yet: processing photos from an earlier (or manual) flight still makes sense.
  if (!stats) return onProcess ? <div className="stats-bar"><ProcessButton onClick={onProcess} /></div> : null

  const items: [string, string][] = [
    ['Photos', stats.photoCount.toLocaleString()],
    ['Flight time', duration(stats.durationS)],
    ['Batteries', String(stats.batteries)],
    stats.areaM2 != null ? ['Area', `${(stats.areaM2 / 10000).toFixed(1)} ha`] : ['Distance', `${(stats.distanceM / 1000).toFixed(2)} km`],
    ['Detail', stats.gsdCm != null ? `${stats.gsdCm.toFixed(1)} cm/px` : '–'],
  ]

  return (
    <div className="stats-bar">
      <dl>
        {items.map(([k, v]) => (
          <div key={k}>
            <dt title={k === "Batteries" ? "Each battery lands with 20% left" : undefined}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {stats.warnings.length > 0 && (
        <div className="warn-wrap">
          <button className="warn-btn" aria-expanded={showWarnings} onClick={() => setShowWarnings(!showWarnings)}>
            {stats.warnings.length === 1 ? '1 thing to check' : `${stats.warnings.length} things to check`}
          </button>
          {showWarnings && (
            <ul className="warn-list">
              {stats.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {onProcess && <ProcessButton onClick={onProcess} />}
      <button className="send-btn" onClick={() => setSendOpen(true)}>
        Send to drone
      </button>
    </div>
  )
}
