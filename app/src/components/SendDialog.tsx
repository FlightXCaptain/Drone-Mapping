import { useState } from 'react'
import { buildKmz } from '../export/wpml'
import { buildLitchiCsv } from '../export/litchi'
import { useCurrentDrone, usePlanner } from '../store'
import type { ExportTarget, Mission } from '../domain/types'
import { Dialog } from './Dialog'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const slug = (s: string) => s.trim().replace(/[^\w-]+/g, '_') || 'mission'

const TARGETS: Record<ExportTarget, { app: string; file: string; summary: string; steps: string[] }> = {
  pilot2: {
    app: 'DJI Pilot 2',
    file: 'KMZ',
    summary: 'Imports directly on Enterprise controllers.',
    steps: [
      'Copy the file to the controller (USB, SD card or a cloud drive).',
      'In DJI Pilot 2, open Flight Route, then Import Route, and choose the file.',
      'Check the height, return-home height and lost-signal action, then fly.',
    ],
  },
  djifly: {
    app: 'DJI Fly',
    file: 'KMZ',
    summary: 'DJI Fly has no import button, so the file replaces a placeholder mission.',
    steps: [
      'In DJI Fly, create and save any short waypoint mission. This is the placeholder.',
      'Connect the controller or phone to a computer and open Android/data/dji.go.v5/files/waypoint/.',
      'Open the newest folder. Rename the downloaded file to match the .kmz inside it, then replace that file.',
      'Restart DJI Fly, open the placeholder mission and check the route before flying.',
    ],
  },
  litchi: {
    app: 'Litchi',
    file: 'CSV',
    summary: 'For drones without built-in waypoints.',
    steps: [
      'Open Litchi Mission Hub at flylitchi.com/hub and sign in.',
      'Choose Missions, then Import, and select the file.',
      'Save it. The mission syncs to the Litchi app on your device.',
    ],
  },
}

export function SendDialog({ mission }: { mission: Mission }) {
  const drone = useCurrentDrone()
  const close = () => usePlanner.getState().setSendOpen(false)
  const [sent, setSent] = useState<ExportTarget | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send(target: ExportTarget) {
    setError(null)
    try {
      if (target === 'litchi') {
        download(new Blob([buildLitchiCsv(mission)], { type: 'text/csv' }), `${slug(mission.name)}.csv`)
      } else {
        download(await buildKmz(mission, drone, target), `${slug(mission.name)}.kmz`)
      }
      setSent(target)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog title="Send to drone" onClose={close}>
      <p className="dialog-lede">
        Download the mission for <strong>{drone.name}</strong>, then load it in the flight app.
      </p>
      <div className="targets">
        {drone.exportTargets.map((t) => (
          <button key={t} className={`target ${sent === t ? 'done' : ''}`} onClick={() => send(t)}>
            <span className="target-app">{TARGETS[t].app}</span>
            <span className="target-sum">{TARGETS[t].summary}</span>
            <span className="target-cta">{sent === t ? 'Downloaded. Download again' : `Download ${TARGETS[t].file}`}</span>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {sent && (
        <section className="steps">
          <h3>Load it in {TARGETS[sent].app}</h3>
          <ol>
            {TARGETS[sent].steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
      )}
      <p className="fine">Always check the route in the flight app before take-off. You are responsible for every flight.</p>
    </Dialog>
  )
}
