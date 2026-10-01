import { useMemo } from 'react'
import { usePlanner } from '../store'
import { compareWithPlan } from '../export/readWpml'
import type { LngLat, Mission } from '../domain/types'

const FINISH: Record<string, string> = { goHome: 'Return home', autoLand: 'Land', gotoFirstWaypoint: 'Fly to first waypoint', noAction: 'Hover' }
const LOST: Record<string, string> = { goBack: 'Return home', landing: 'Land', hover: 'Hover' }

/**
 * Shows a mission read back from the controller (or a file): every waypoint's coordinates,
 * height, camera angle and photo, plus whether it matches the current plan. This reads the
 * same file the aircraft executes, so it's a check that doesn't rely on DJI Fly's display.
 */
export function InspectPanel({ plan, onFocus }: { plan: Mission | null; onFocus: (p: LngLat) => void }) {
  const inspected = usePlanner((s) => s.inspected)
  const close = () => usePlanner.getState().setInspected(null)
  const cmp = useMemo(() => (inspected && plan ? compareWithPlan(inspected.read, plan) : null), [inspected, plan])
  if (!inspected) return null
  const { read, source } = inspected
  const heights = read.waypoints.map((w) => w.heightM)
  const photos = read.waypoints.filter((w) => w.photo).length

  return (
    <aside className="inspect" aria-label="Mission check">
      <header>
        <div>
          <h2>Mission check</h2>
          <p className="fine">{source}</p>
        </div>
        <button className="icon-btn" onClick={close} aria-label="Close mission check">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {cmp && (
        <div className={`verdict ${cmp.matches ? 'ok' : 'bad'}`}>
          {cmp.matches ? (
            <strong>Matches your plan exactly: every position, height and photo.</strong>
          ) : (
            <>
              <strong>Differs from your plan</strong>
              <ul>
                {cmp.differences.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <dl className="inspect-facts">
        <div><dt>Waypoints</dt><dd>{read.waypoints.length}</dd></div>
        <div><dt>Photos</dt><dd>{photos}</dd></div>
        <div><dt>Heights</dt><dd>{Math.min(...heights)}–{Math.max(...heights)} m</dd></div>
        <div><dt>Height from</dt><dd>{read.heightMode === 'relativeToStartPoint' ? 'Take-off point' : (read.heightMode ?? '?')}</dd></div>
        <div><dt>When finished</dt><dd>{FINISH[read.finishAction ?? ''] ?? read.finishAction ?? '?'}</dd></div>
        <div><dt>Signal lost</dt><dd>{LOST[read.rcLostAction ?? ''] ?? read.rcLostAction ?? '?'}</dd></div>
      </dl>

      <div className="inspect-table">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Height</th>
              <th>Camera</th>
              <th>Photo</th>
            </tr>
          </thead>
          <tbody>
            {read.waypoints.map((w, i) => (
              <tr key={i} onClick={() => onFocus(w.position)} title="Show on map">
                <td>{i + 1}</td>
                <td>{w.position[1].toFixed(6)}</td>
                <td>{w.position[0].toFixed(6)}</td>
                <td>{w.heightM} m</td>
                <td>{w.gimbalPitchDeg === null ? '–' : `${w.gimbalPitchDeg}°`}</td>
                <td>{w.photo ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">Tap a row to find that waypoint on the map. Heights are above the take-off point.</p>
    </aside>
  )
}
