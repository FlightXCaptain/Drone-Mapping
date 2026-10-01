import { area as turfArea, polygon as turfPolygon } from '@turf/turf'
import { currentParts, partLabel, usePlanner, type Part } from '../store'

function summary(p: Part): string {
  if (p.missionType === 'grid') {
    if (!p.area) return 'Not drawn yet'
    return `${p.grid.altitudeM} m, ${(turfArea(turfPolygon([p.area])) / 10000).toFixed(1)} ha`
  }
  if (!p.orbitCenter) return 'Not placed yet'
  return `${p.orbit.rings.length} ring${p.orbit.rings.length === 1 ? '' : 's'}`
}

const Arrow = ({ up }: { up?: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
    <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** The mission's flight parts in the order they're flown. Tap one to edit it. */
export function PartsList() {
  const s = usePlanner()
  const parts = currentParts(s)

  return (
    <div className="field">
      <span className="field-label">Flight parts, in flying order</span>
      <ol className="parts">
        {parts.map((p, i) => {
          const active = p.id === s.activePartId
          return (
            <li key={p.id} className={active ? 'on' : ''}>
              <button className="part-main" onClick={() => s.selectPart(p.id)} aria-current={active ? 'true' : undefined}>
                <span className="part-num">{i + 1}</span>
                <span className="part-name">{partLabel(p)}</span>
                <span className="part-meta">{summary(p)}</span>
              </button>
              {parts.length > 1 && (
                <span className="part-tools">
                  <button className="icon-btn small" disabled={i === 0} onClick={() => s.movePart(p.id, -1)} aria-label={`Fly part ${i + 1} earlier`}>
                    <Arrow up />
                  </button>
                  <button className="icon-btn small" disabled={i === parts.length - 1} onClick={() => s.movePart(p.id, 1)} aria-label={`Fly part ${i + 1} later`}>
                    <Arrow />
                  </button>
                  <button className="icon-btn small" onClick={() => s.removePart(p.id)} aria-label={`Remove part ${i + 1}`}>
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ol>
      <div className="add-parts">
        <button className="text-btn" onClick={() => s.addPart('grid')}>
          + Add area map
        </button>
        <button className="text-btn" onClick={() => s.addPart('orbit')}>
          + Add orbit
        </button>
      </div>
      {parts.length > 1 && <span className="slider-note">Flown back to back. Between parts the drone climbs to the higher part's height before crossing.</span>}
    </div>
  )
}
