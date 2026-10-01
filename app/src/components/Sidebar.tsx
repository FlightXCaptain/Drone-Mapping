import { useState } from 'react'
import { useAllDrones, usePlanner } from '../store'
import { altitudeForGsd, gsdCm, gridSpacing } from '../domain/photogrammetry'
import { bearingDeg, distanceM } from '../domain/geo'
import type { DroneProfile, Mission, MissionStats } from '../domain/types'
import { DroneEditor } from './DroneEditor'
import { ExportPanel } from './ExportPanel'

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  hint?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="field">
      <span className="field-head">
        <span>{props.label}</span>
        <span className="field-val">
          <input
            type="number"
            value={props.value}
            min={props.min}
            max={props.max}
            step={props.step ?? 1}
            onChange={(e) => props.onChange(Number(e.target.value))}
          />
          {props.unit}
        </span>
      </span>
      <input
        type="range"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint && <small className="hint">{props.hint}</small>}
    </label>
  )
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${Math.round(s % 60)}s`
}

function GridControls({ drone }: { drone: DroneProfile }) {
  const grid = usePlanner((s) => s.grid)
  const area = usePlanner((s) => s.area)
  const update = usePlanner((s) => s.updateGrid)
  const gsd = gsdCm(drone.camera, grid.altitudeM)
  const { lineSpacingM, photoSpacingM } = gridSpacing(drone.camera, grid.altitudeM, grid.frontOverlap, grid.sideOverlap)

  function alignToLongestEdge() {
    if (!area) return
    let best = 0
    let bearing = grid.angleDeg
    for (let i = 0; i < area.length - 1; i++) {
      const d = distanceM(area[i], area[i + 1])
      if (d > best) {
        best = d
        bearing = bearingDeg(area[i], area[i + 1])
      }
    }
    update({ angleDeg: Math.round(bearing % 180) })
  }

  return (
    <>
      <div className="presets">
        <button
          onClick={() => update({ gimbalPitchDeg: -90, crosshatch: false, frontOverlap: 0.75, sideOverlap: 0.65 })}
          title="Nadir single grid – fastest, best for orthomosaics and DEMs"
        >
          2D map
        </button>
        <button
          onClick={() => update({ gimbalPitchDeg: -65, crosshatch: true, frontOverlap: 0.8, sideOverlap: 0.7 })}
          title="Oblique double grid – captures building sides for 3D meshes"
        >
          3D model
        </button>
      </div>
      <Slider
        label="Altitude"
        value={grid.altitudeM}
        min={10}
        max={120}
        unit="m"
        hint={`GSD ${gsd.toFixed(2)} cm/px · lines ${lineSpacingM.toFixed(1)} m apart · photo every ${photoSpacingM.toFixed(1)} m`}
        onChange={(v) => update({ altitudeM: v })}
      />
      <label className="field inline">
        <span>Target GSD</span>
        <input
          type="number"
          step={0.1}
          min={0.3}
          placeholder="cm/px"
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v > 0) update({ altitudeM: Math.round(altitudeForGsd(drone.camera, v)) })
          }}
        />
        <small>cm/px → sets altitude</small>
      </label>
      <Slider label="Front overlap" value={Math.round(grid.frontOverlap * 100)} min={50} max={95} unit="%" onChange={(v) => update({ frontOverlap: v / 100 })} />
      <Slider label="Side overlap" value={Math.round(grid.sideOverlap * 100)} min={40} max={90} unit="%" onChange={(v) => update({ sideOverlap: v / 100 })} />
      <Slider label="Line direction" value={grid.angleDeg} min={0} max={179} unit="°" onChange={(v) => update({ angleDeg: v })} />
      <button className="link" onClick={alignToLongestEdge} disabled={!area}>
        ↦ Align lines to longest edge
      </button>
      <Slider label="Speed" value={grid.speedMs} min={1} max={drone.maxSpeedMs} step={0.5} unit="m/s" onChange={(v) => update({ speedMs: v })} />
      <Slider label="Gimbal pitch" value={grid.gimbalPitchDeg} min={-90} max={-30} unit="°" hint="-90 = straight down" onChange={(v) => update({ gimbalPitchDeg: v })} />
      <label className="check">
        <input type="checkbox" checked={grid.crosshatch} onChange={(e) => update({ crosshatch: e.target.checked })} />
        Crosshatch (second pass at 90°)
      </label>
      <label className="field inline">
        <span>Photo trigger</span>
        <select value={grid.triggerMode} onChange={(e) => update({ triggerMode: e.target.value as 'interval' | 'waypoint' })}>
          <option value="interval">Distance interval (smooth, few waypoints)</option>
          <option value="waypoint">Waypoint per photo (most compatible)</option>
        </select>
      </label>
    </>
  )
}

function OrbitControls({ drone }: { drone: DroneProfile }) {
  const orbit = usePlanner((s) => s.orbit)
  const subjectHeightM = usePlanner((s) => s.subjectHeightM)
  const ringCount = usePlanner((s) => s.ringCount)
  const { updateOrbit, setSubjectHeight, setRingCount } = usePlanner.getState()
  return (
    <>
      <p className="hint">Orbits capture a subject from every side. This is what Gaussian splats and object 3D models need.</p>
      <Slider label="Subject height" value={subjectHeightM} min={1} max={100} unit="m" onChange={setSubjectHeight} />
      <Slider label="Radius" value={orbit.radiusM} min={5} max={200} unit="m" onChange={(v) => updateOrbit({ radiusM: v })} />
      <Slider label="Rings" value={ringCount} min={1} max={6} onChange={setRingCount} />
      <Slider label="Photos per ring" value={orbit.photosPerRing} min={8} max={90} onChange={(v) => updateOrbit({ photosPerRing: v })} hint={`One photo every ${(360 / orbit.photosPerRing).toFixed(1)}°`} />
      <Slider label="Speed" value={orbit.speedMs} min={1} max={Math.min(10, drone.maxSpeedMs)} step={0.5} unit="m/s" onChange={(v) => updateOrbit({ speedMs: v })} />
      <table className="rings">
        <thead>
          <tr><th>Ring</th><th>Alt (m)</th><th>Pitch (°)</th></tr>
        </thead>
        <tbody>
          {orbit.rings.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <input type="number" value={r.altitudeM} onChange={(e) => updateOrbit({ rings: orbit.rings.map((x, j) => (j === i ? { ...x, altitudeM: Number(e.target.value) } : x)) })} />
              </td>
              <td>
                <input type="number" value={r.gimbalPitchDeg} min={-90} max={0} onChange={(e) => updateOrbit({ rings: orbit.rings.map((x, j) => (j === i ? { ...x, gimbalPitchDeg: Number(e.target.value) } : x)) })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function Sidebar({ mission, stats, drone }: { mission: Mission | null; stats: MissionStats | null; drone: DroneProfile }) {
  const drones = useAllDrones()
  const s = usePlanner()
  const [editing, setEditing] = useState<DroneProfile | 'new' | null>(null)

  const tools =
    s.missionType === 'grid'
      ? ([
          ['polygon', '⬠ Draw area'],
          ['rectangle', '▭ Rectangle'],
          ['select', '✥ Edit'],
        ] as const)
      : ([
          ['point', '◎ Place subject'],
          ['select', '✥ Move'],
        ] as const)

  return (
    <aside className="sidebar">
      <header>
        <h1>Drone Mapping</h1>
        <input className="mission-name" value={s.missionName} onChange={(e) => s.setMissionName(e.target.value)} aria-label="Mission name" />
      </header>

      <section>
        <h2>1 · Aircraft</h2>
        <div className="row">
          <select value={drone.id} onChange={(e) => s.setDrone(e.target.value)}>
            {drones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.builtin ? '' : ' (custom)'}
              </option>
            ))}
          </select>
          <button onClick={() => setEditing(drone.builtin ? { ...drone, id: crypto.randomUUID(), name: `${drone.name} (copy)`, builtin: false } : drone)}>
            {drone.builtin ? 'Copy' : 'Edit'}
          </button>
          <button onClick={() => setEditing('new')}>+ Add</button>
        </div>
        {drone.notes && <small className="hint">{drone.notes}</small>}
        {editing && <DroneEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </section>

      <section>
        <h2>2 · Mission</h2>
        <div className="seg wide">
          <button className={s.missionType === 'grid' ? 'on' : ''} onClick={() => s.setMissionType('grid')}>
            Mapping grid
          </button>
          <button className={s.missionType === 'orbit' ? 'on' : ''} onClick={() => s.setMissionType('orbit')}>
            Orbit / Splat
          </button>
        </div>
        <div className="tools">
          {tools.map(([tool, label]) => (
            <button key={tool} className={s.drawTool === tool ? 'on' : ''} onClick={() => s.setDrawTool(s.drawTool === tool ? null : tool)}>
              {label}
            </button>
          ))}
          <button className="danger" onClick={() => (s.missionType === 'grid' ? s.setArea(null) : s.setOrbitCenter(null))}>
            Clear
          </button>
        </div>
        {s.drawTool === 'polygon' && <small className="hint">Tap to add corners. Tap the first point (or double-tap) to finish.</small>}
      </section>

      <section>
        <h2>3 · Settings</h2>
        {s.missionType === 'grid' ? <GridControls drone={drone} /> : <OrbitControls drone={drone} />}
      </section>

      {stats && mission && mission.waypoints.length > 0 && (
        <section>
          <h2>4 · Summary</h2>
          <dl className="stats">
            <div><dt>Photos</dt><dd>{stats.photoCount}</dd></div>
            <div><dt>Waypoints</dt><dd>{stats.waypointCount}</dd></div>
            <div><dt>Distance</dt><dd>{(stats.distanceM / 1000).toFixed(2)} km</dd></div>
            <div><dt>Flight time</dt><dd>{fmtDuration(stats.durationS)}</dd></div>
            <div><dt>Batteries</dt><dd>{stats.batteries}</dd></div>
            {stats.areaM2 != null && <div><dt>Area</dt><dd>{(stats.areaM2 / 10000).toFixed(2)} ha</dd></div>}
            {stats.gsdCm != null && <div><dt>GSD</dt><dd>{stats.gsdCm.toFixed(2)} cm</dd></div>}
          </dl>
          {stats.warnings.map((w) => (
            <p key={w} className="warn">⚠ {w}</p>
          ))}
          <ExportPanel mission={mission} drone={drone} />
        </section>
      )}
    </aside>
  )
}
