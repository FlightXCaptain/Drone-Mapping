import { useState } from 'react'
import { usePlanner } from '../store'
import type { MissionStats } from '../domain/types'

function duration(s: number) {
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.max(1, m)} min`
}

export function StatsBar({ stats }: { stats: MissionStats | null }) {
  const setSendOpen = usePlanner((s) => s.setSendOpen)
  const [showWarnings, setShowWarnings] = useState(false)
  if (!stats) return null

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
      <button className="send-btn" onClick={() => setSendOpen(true)}>
        Send to drone
      </button>
    </div>
  )
}
