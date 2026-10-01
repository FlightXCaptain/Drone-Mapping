import { useState } from 'react'
import { usePlanner } from '../store'
import type { DroneProfile, ExportTarget } from '../domain/types'

const BLANK: DroneProfile = {
  id: '',
  name: '',
  builtin: false,
  camera: { sensorWidthMm: 13.2, sensorHeightMm: 8.8, focalLengthMm: 8.8, imageWidthPx: 5472, imageHeightPx: 3648 },
  maxSpeedMs: 15,
  flightTimeMin: 30,
  minPhotoIntervalS: 2,
  maxWaypoints: 200,
  exportTargets: ['litchi'],
}

const TARGETS: [ExportTarget, string][] = [
  ['pilot2', 'DJI Pilot 2 (Enterprise KMZ)'],
  ['djifly', 'DJI Fly (KMZ file swap)'],
  ['litchi', 'Litchi CSV'],
]

/** Create or edit a client-defined aircraft. Camera numbers come from the spec sheet or a photo's EXIF. */
export function DroneEditor({ initial, onClose }: { initial: DroneProfile | null; onClose: () => void }) {
  const save = usePlanner((s) => s.saveCustomDrone)
  const remove = usePlanner((s) => s.deleteCustomDrone)
  const [d, setD] = useState<DroneProfile>(initial ?? { ...BLANK, id: crypto.randomUUID() })

  const num = (path: string, label: string, step = 0.1) => {
    const [group, key] = path.includes('.') ? path.split('.') : [null, path]
    const value = group ? (d as any)[group][key] : (d as any)[key]
    return (
      <label className="field inline">
        <span>{label}</span>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value)
            setD((prev) => (group ? { ...prev, [group]: { ...(prev as any)[group], [key]: v } } : { ...prev, [key]: v }))
          }}
        />
      </label>
    )
  }

  const wpml = d.wpml ?? { droneEnumValue: 0, droneSubEnumValue: 0, payloadEnumValue: 0, payloadSubEnumValue: 0 }

  return (
    <div className="editor">
      <label className="field inline">
        <span>Name</span>
        <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Client's Air 3S" />
      </label>
      <h3>Camera</h3>
      {num('camera.sensorWidthMm', 'Sensor width (mm)')}
      {num('camera.sensorHeightMm', 'Sensor height (mm)')}
      {num('camera.focalLengthMm', 'Focal length, real (mm)')}
      {num('camera.imageWidthPx', 'Image width (px)', 1)}
      {num('camera.imageHeightPx', 'Image height (px)', 1)}
      <h3>Performance</h3>
      {num('maxSpeedMs', 'Max speed (m/s)', 0.5)}
      {num('flightTimeMin', 'Rated flight time (min)', 1)}
      {num('minPhotoIntervalS', 'Min photo interval (s)', 0.1)}
      {num('maxWaypoints', 'Max waypoints', 1)}
      <h3>Export</h3>
      {TARGETS.map(([t, label]) => (
        <label key={t} className="check">
          <input
            type="checkbox"
            checked={d.exportTargets.includes(t)}
            onChange={(e) =>
              setD({ ...d, exportTargets: e.target.checked ? [...d.exportTargets, t] : d.exportTargets.filter((x) => x !== t) })
            }
          />
          {label}
        </label>
      ))}
      {(d.exportTargets.includes('pilot2') || d.exportTargets.includes('djifly')) && (
        <div className="wpml-ids">
          <small className="hint">WPML IDs identify the aircraft inside the KMZ. Copy them from a mission saved on the controller if unsure.</small>
          {(['droneEnumValue', 'droneSubEnumValue', 'payloadEnumValue', 'payloadSubEnumValue'] as const).map((k) => (
            <label key={k} className="field inline">
              <span>{k}</span>
              <input type="number" value={wpml[k]} onChange={(e) => setD({ ...d, wpml: { ...wpml, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <button
          className="primary"
          disabled={!d.name.trim() || d.exportTargets.length === 0}
          onClick={() => {
            save({ ...d, builtin: false })
            onClose()
          }}
        >
          Save aircraft
        </button>
        {initial && !initial.builtin && (
          <button
            className="danger"
            onClick={() => {
              remove(d.id)
              onClose()
            }}
          >
            Delete
          </button>
        )}
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
