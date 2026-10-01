import { uid } from '../util'
import { useState } from 'react'
import { useAllDrones, useCurrentDrone, usePlanner } from '../store'
import { altitudeForGsd, gsdCm, gridSpacing } from '../domain/photogrammetry'
import type { DroneProfile } from '../domain/types'
import { OrbitProfile } from './OrbitProfile'
import { PartsList } from './PartsList'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  note?: string
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step = 1, unit, note, onChange }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <span className="slider-value">
          <input
            type="number"
            inputMode="decimal"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span>{unit}</span>
        </span>
      </span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {note && <span className="slider-note">{note}</span>}
    </label>
  )
}

function Choice<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: [T, string][]
  value: T | null
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

const OVERLAPS: Record<string, [number, number]> = { light: [0.7, 0.6], standard: [0.8, 0.7], heavy: [0.85, 0.8] }

function GridSettings({ drone }: { drone: DroneProfile }) {
  const grid = usePlanner((s) => s.grid)
  const update = usePlanner((s) => s.updateGrid)
  const gsd = gsdCm(drone.camera, grid.altitudeM)
  const { lineSpacingM, photoSpacingM } = gridSpacing(drone.camera, grid.altitudeM, grid.frontOverlap, grid.sideOverlap)
  const overlap = Object.entries(OVERLAPS).find(([, [f, s]]) => f === grid.frontOverlap && s === grid.sideOverlap)?.[0] ?? null
  const purpose = grid.gimbalPitchDeg === -90 && !grid.crosshatch ? '2d' : grid.crosshatch && grid.gimbalPitchDeg > -90 ? '3d' : null

  return (
    <>
      <div className="field">
        <span className="field-label">Output</span>
        <Choice
          label="Output"
          value={purpose}
          options={[
            ['2d', 'Flat map'],
            ['3d', '3D model'],
          ]}
          onChange={(v) =>
            update(v === '2d' ? { gimbalPitchDeg: -90, crosshatch: false } : { gimbalPitchDeg: -65, crosshatch: true, ...(overlap === 'light' ? { frontOverlap: 0.8, sideOverlap: 0.7 } : {}) })
          }
        />
      </div>
      <Slider
        label="Height"
        value={grid.altitudeM}
        min={10}
        max={120}
        unit="m"
        note={`${gsd.toFixed(1)} cm per pixel`}
        onChange={(v) => update({ altitudeM: v })}
      />
      <div className="field">
        <span className="field-label">Overlap</span>
        <Choice
          label="Overlap"
          value={overlap}
          options={[
            ['light', 'Light'],
            ['standard', 'Standard'],
            ['heavy', 'Heavy'],
          ]}
          onChange={(v) => update({ frontOverlap: OVERLAPS[v][0], sideOverlap: OVERLAPS[v][1] })}
        />
        <span className="slider-note">
          Lines {lineSpacingM.toFixed(0)} m apart, a photo every {photoSpacingM.toFixed(0)} m
        </span>
      </div>

      <details className="more">
        <summary>More settings</summary>
        <label className="inline">
          <span>Target detail</span>
          <span className="unit-input">
            <input
              type="number"
              step={0.1}
              min={0.3}
              placeholder={gsd.toFixed(1)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v > 0) update({ altitudeM: Math.min(120, Math.round(altitudeForGsd(drone.camera, v))) })
              }}
            />
            cm/px
          </span>
        </label>
        <Slider label="Line direction" value={grid.angleDeg} min={0} max={359} unit="°" note="Or drag the rotate knob on the map" onChange={(v) => update({ angleDeg: v })} />
        <Slider label="Speed" value={grid.speedMs} min={1} max={drone.maxSpeedMs} step={0.5} unit="m/s" onChange={(v) => update({ speedMs: v })} />
        <Slider label="Camera angle" value={grid.gimbalPitchDeg} min={-90} max={-30} unit="°" note="-90° points straight down" onChange={(v) => update({ gimbalPitchDeg: v })} />
        <Slider label="Front overlap" value={Math.round(grid.frontOverlap * 100)} min={50} max={95} unit="%" onChange={(v) => update({ frontOverlap: v / 100 })} />
        <Slider label="Side overlap" value={Math.round(grid.sideOverlap * 100)} min={40} max={90} unit="%" onChange={(v) => update({ sideOverlap: v / 100 })} />
        <label className="toggle">
          <input type="checkbox" checked={grid.crosshatch} onChange={(e) => update({ crosshatch: e.target.checked })} />
          <span>Fly a second pass across the first</span>
        </label>
        <div className="field">
          <span className="field-label">Take photos</span>
          <Choice
            label="Take photos"
            value={grid.triggerMode}
            options={[
              ['interval', 'While flying'],
              ['waypoint', 'At each stop'],
            ]}
            onChange={(v) => update({ triggerMode: v })}
          />
          <span className="slider-note">
            {grid.triggerMode === 'interval' ? 'Smooth and quick. Needs DJI Pilot 2 or Litchi.' : 'Slower, but works in every app including DJI Fly.'}
          </span>
        </div>
      </details>
    </>
  )
}

function OrbitSettings({ drone }: { drone: DroneProfile }) {
  const orbit = usePlanner((s) => s.orbit)
  const subjectHeightM = usePlanner((s) => s.subjectHeightM)
  const ringCount = usePlanner((s) => s.ringCount)
  const { updateOrbit, setSubjectHeight, setRingCount, updateRing, addRing, removeRing } = usePlanner.getState()
  return (
    <>
      <Slider label="Subject height" value={subjectHeightM} min={1} max={100} unit="m" onChange={setSubjectHeight} />
      <Slider label="Distance from subject" value={orbit.radiusM} min={5} max={200} unit="m" note="Or drag the ring on the map" onChange={(v) => updateOrbit({ radiusM: v })} />
      <div className="field">
        <span className="field-label">Rings (quick setup)</span>
        <Choice label="Rings" value={ringCount} options={[1, 2, 3, 4, 5].map((n) => [n, String(n)] as [number, string])} onChange={setRingCount} />
      </div>
      <OrbitProfile rings={orbit.rings} radiusM={orbit.radiusM} subjectHeightM={subjectHeightM} />
      <div className="field">
        <span className="field-label">Each ring</span>
        <table className="rings">
          <thead>
            <tr>
              <th>Height</th>
              <th>Distance</th>
              <th>Camera</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orbit.rings.map((r, i) => (
              <tr key={i}>
                <td>
                  <span className="unit-input">
                    <input type="number" value={r.altitudeM} min={2} max={120} onChange={(e) => updateRing(i, { altitudeM: Number(e.target.value) })} aria-label={`Ring ${i + 1} height`} />m
                  </span>
                </td>
                <td>
                  <span className="unit-input">
                    <input type="number" value={r.radiusM ?? orbit.radiusM} min={3} max={500} onChange={(e) => updateRing(i, { radiusM: Number(e.target.value) })} aria-label={`Ring ${i + 1} distance`} />m
                  </span>
                </td>
                <td>
                  <span className="unit-input">
                    <input type="number" value={r.gimbalPitchDeg} min={-90} max={0} onChange={(e) => updateRing(i, { gimbalPitchDeg: Number(e.target.value) })} aria-label={`Ring ${i + 1} camera angle`} />°
                  </span>
                </td>
                <td>
                  <button className="icon-btn small" onClick={() => removeRing(i)} disabled={orbit.rings.length <= 1} aria-label={`Remove ring ${i + 1}`}>
                    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="text-btn" onClick={addRing}>Add a ring</button>
        <span className="slider-note">Changing height or distance re-aims the camera at the subject.</span>
      </div>
      <Slider label="Photos per ring" value={orbit.photosPerRing} min={8} max={90} unit="" note={`One every ${(360 / orbit.photosPerRing).toFixed(0)}°`} onChange={(v) => updateOrbit({ photosPerRing: v })} />
      <details className="more">
        <summary>More settings</summary>
        <Slider label="Speed" value={orbit.speedMs} min={1} max={Math.min(10, drone.maxSpeedMs)} step={0.5} unit="m/s" onChange={(v) => updateOrbit({ speedMs: v })} />
        <div className="field">
          <span className="field-label">Direction</span>
          <Choice
            label="Direction"
            value={orbit.clockwise ? 'cw' : 'ccw'}
            options={[
              ['cw', 'Clockwise'],
              ['ccw', 'Anticlockwise'],
            ]}
            onChange={(v) => updateOrbit({ clockwise: v === 'cw' })}
          />
        </div>

      </details>
    </>
  )
}

export function ControlCard() {
  const drones = useAllDrones()
  const drone = useCurrentDrone()
  const s = usePlanner()
  // Start folded away on phones so the map gets the screen.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 820px)').matches)

  return (
    <aside className={`card ${collapsed ? 'collapsed' : ''}`}>
      <div className="card-head">
        <input className="mission-name" value={s.missionName} onChange={(e) => s.setMissionName(e.target.value)} aria-label="Mission name" />
        <button className="icon-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Show settings' : 'Hide settings'} aria-expanded={!collapsed}>
          <svg viewBox="0 0 24 24" width="20" height="20" style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}>
            <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="card-body">
        <div className="field">
          <span className="field-label">Aircraft</span>
          <select
            value={drone.id}
            onChange={(e) => (e.target.value === '__add' ? s.setDroneEditor('new') : s.setDrone(e.target.value))}
          >
            <optgroup label="Your aircraft">
              {drones.filter((d) => !d.builtin).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
              <option value="__add">Add your own aircraft…</option>
            </optgroup>
            <optgroup label="DJI">
              {drones.filter((d) => d.builtin).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </optgroup>
          </select>
          <button
            className="text-btn"
            onClick={() => s.setDroneEditor(drone.builtin ? { ...drone, id: uid(), name: `${drone.name} (mine)`, builtin: false } : drone)}
          >
            {drone.builtin ? 'Copy and adjust specs' : 'Edit specs'}
          </button>
        </div>

        <PartsList />

        <Choice
          label="Mission type"
          value={s.missionType}
          options={[
            ['grid', 'Map an area'],
            ['orbit', 'Orbit a subject'],
          ]}
          onChange={s.setMissionType}
        />

        {s.missionType === 'grid' ? <GridSettings drone={drone} /> : <OrbitSettings drone={drone} />}
      </div>
    </aside>
  )
}
