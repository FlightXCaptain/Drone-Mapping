import { uid } from '../util'
import { useState } from 'react'
import { usePlanner } from '../store'
import type { DroneProfile, ExportTarget } from '../domain/types'
import { Dialog } from './Dialog'

const BLANK: Omit<DroneProfile, 'id'> = {
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
  ['pilot2', 'DJI Pilot 2'],
  ['djifly', 'DJI Fly'],
  ['litchi', 'Litchi'],
]

type NumPath =
  | `camera.${keyof DroneProfile['camera']}`
  | 'maxSpeedMs'
  | 'flightTimeMin'
  | 'minPhotoIntervalS'
  | 'maxWaypoints'

/** Add or edit a client's aircraft. Camera numbers come from the spec sheet or a photo's EXIF data. */
export function DroneEditor({ initial }: { initial: DroneProfile | null }) {
  const { saveCustomDrone, deleteCustomDrone, setDroneEditor } = usePlanner.getState()
  const close = () => setDroneEditor(null)
  const [d, setD] = useState<DroneProfile>(initial ?? { ...BLANK, id: uid() })
  const existing = usePlanner((s) => s.customDrones.some((x) => x.id === d.id))

  const get = (p: NumPath) => (p.startsWith('camera.') ? d.camera[p.slice(7) as keyof DroneProfile['camera']] : d[p as keyof DroneProfile]) as number
  const put = (p: NumPath, v: number) =>
    setD((prev) => (p.startsWith('camera.') ? { ...prev, camera: { ...prev.camera, [p.slice(7)]: v } } : { ...prev, [p]: v }))

  const num = (p: NumPath, label: string, unit: string, step = 0.1) => (
    <label className="inline">
      <span>{label}</span>
      <span className="unit-input">
        <input type="number" inputMode="decimal" step={step} value={get(p)} onChange={(e) => put(p, Number(e.target.value))} />
        {unit}
      </span>
    </label>
  )

  const wpml = d.wpml ?? { droneEnumValue: 0, droneSubEnumValue: 0, payloadEnumValue: 0, payloadSubEnumValue: 0 }
  const needsWpml = d.exportTargets.includes('pilot2') || d.exportTargets.includes('djifly')

  return (
    <Dialog title={existing ? 'Edit aircraft' : 'Add aircraft'} onClose={close}>
      <form
        className="drone-form"
        onSubmit={(e) => {
          e.preventDefault()
          saveCustomDrone({ ...d, builtin: false })
          close()
        }}
      >
        <label className="stack">
          <span>Name</span>
          <input required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Site team Air 3S" />
        </label>

        <fieldset>
          <legend>Camera</legend>
          {num('camera.sensorWidthMm', 'Sensor width', 'mm')}
          {num('camera.sensorHeightMm', 'Sensor height', 'mm')}
          {num('camera.focalLengthMm', 'Focal length (real, not 35 mm equivalent)', 'mm')}
          {num('camera.imageWidthPx', 'Photo width', 'px', 1)}
          {num('camera.imageHeightPx', 'Photo height', 'px', 1)}
        </fieldset>

        <fieldset>
          <legend>Flight</legend>
          {num('flightTimeMin', 'Rated flight time', 'min', 1)}
          {num('maxSpeedMs', 'Top speed', 'm/s', 0.5)}
          {num('minPhotoIntervalS', 'Fastest photo interval', 's')}
          {num('maxWaypoints', 'Waypoint limit', '', 1)}
        </fieldset>

        <fieldset>
          <legend>Flight apps</legend>
          <div className="checks">
            {TARGETS.map(([t, label]) => (
              <label key={t} className="toggle">
                <input
                  type="checkbox"
                  checked={d.exportTargets.includes(t)}
                  onChange={(e) =>
                    setD({ ...d, exportTargets: e.target.checked ? [...d.exportTargets, t] : d.exportTargets.filter((x) => x !== t) })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {needsWpml && (
            <details className="more">
              <summary>DJI aircraft codes</summary>
              <p className="slider-note">These identify the aircraft inside DJI mission files. If unsure, copy them from a mission saved on your controller.</p>
              {(
                [
                  ['droneEnumValue', 'Aircraft code'],
                  ['droneSubEnumValue', 'Aircraft variant'],
                  ['payloadEnumValue', 'Camera code'],
                  ['payloadSubEnumValue', 'Camera variant'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="inline">
                  <span>{label}</span>
                  <input type="number" value={wpml[k]} onChange={(e) => setD({ ...d, wpml: { ...wpml, [k]: Number(e.target.value) } })} />
                </label>
              ))}
            </details>
          )}
        </fieldset>

        <div className="dialog-actions">
          {existing && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                deleteCustomDrone(d.id)
                close()
              }}
            >
              Delete aircraft
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!d.name.trim() || d.exportTargets.length === 0}>
            Save aircraft
          </button>
        </div>
      </form>
    </Dialog>
  )
}
