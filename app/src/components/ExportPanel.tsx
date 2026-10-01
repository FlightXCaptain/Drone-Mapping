import { useState } from 'react'
import { buildKmz } from '../export/wpml'
import { buildLitchiCsv } from '../export/litchi'
import type { DroneProfile, ExportTarget, Mission } from '../domain/types'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const slug = (s: string) => s.trim().replace(/[^\w-]+/g, '_') || 'mission'

const HOW_TO: Record<ExportTarget, { label: string; steps: string[] }> = {
  pilot2: {
    label: 'KMZ for DJI Pilot 2',
    steps: [
      'Copy the .kmz to the controller (USB, SD card or cloud drive).',
      'In DJI Pilot 2, open Flight Route → Import Route (KMZ/KML) and pick the file.',
      'Check altitude, the RC-lost action and the take-off point, then fly.',
    ],
  },
  djifly: {
    label: 'KMZ for DJI Fly',
    steps: [
      'In DJI Fly, create and save any throw-away waypoint mission so the app makes its folder.',
      'Connect the RC 2 / phone to a computer and open Android/data/dji.go.v5/files/waypoint/<UUID>/.',
      'Replace the <UUID>.kmz in that folder with this file, keeping the original UUID filename.',
      'Restart DJI Fly and open the mission. Check it on the map before flying.',
    ],
  },
  litchi: {
    label: 'CSV for Litchi',
    steps: [
      'Open Litchi Mission Hub (flylitchi.com/hub) and choose Missions → Import.',
      'Select this CSV, review it and save. It syncs to the Litchi app on your device.',
    ],
  },
}

export function ExportPanel({ mission, drone }: { mission: Mission; drone: DroneProfile }) {
  const [open, setOpen] = useState<ExportTarget | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(target: ExportTarget) {
    setError(null)
    try {
      if (target === 'litchi') {
        download(new Blob([buildLitchiCsv(mission)], { type: 'text/csv' }), `${slug(mission.name)}.csv`)
      } else {
        download(await buildKmz(mission, drone, target), `${slug(mission.name)}.kmz`)
      }
      setOpen(target)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="export">
      <h3>Send to aircraft</h3>
      <div className="row wrap">
        {drone.exportTargets.map((t) => (
          <button key={t} className="primary" onClick={() => run(t)}>
            ⤓ {HOW_TO[t].label}
          </button>
        ))}
      </div>
      {error && <p className="warn">⚠ {error}</p>}
      {open && (
        <ol className="howto">
          {HOW_TO[open].steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
