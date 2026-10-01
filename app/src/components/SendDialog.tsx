import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { planUrl } from '../share'
import { copyText } from '../util'
import { buildKmz } from '../export/wpml'
import { buildLitchiCsv } from '../export/litchi'
import { readKmz } from '../export/readWpml'
import { useCurrentDrone, usePlanner } from '../store'
import type { ExportTarget, Mission } from '../domain/types'
import { Dialog } from './Dialog'
import { ControllerSend } from './ControllerSend'

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
      'In DJI Fly, create and save any short waypoint mission as a placeholder. Then restart the controller so DJI Fly is fully closed.',
      'Switch the controller on and connect it to your Windows PC with a data USB cable.',
      'Easiest: run tools\send-to-dji-fly.ps1 from the Drone Mapping folder. It backs up the placeholder, puts this file in its place and checks it.',
      'By hand instead: open Android/data/dji.go.v5/files/waypoint/<UUID>/ and replace <UUID>.kmz with this file, renamed to that exact name.',
      'Restart the controller before opening DJI Fly (it caches missions and can write its old copy back). Then open the mission; its thumbnail keeps showing the old route, which is normal.',
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

/** QR code + link that opens this exact plan on another device (no server involved). */
function HandOff({ compact = false }: { compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    planUrl(usePlanner.getState().toPlan()).then(async (u) => {
      const img = await QRCode.toDataURL(u, { errorCorrectionLevel: 'L', margin: 1, width: 360, color: { dark: '#13294b', light: '#ffffff' } })
      if (live) {
        setUrl(u)
        setQr(img)
      }
    })
    return () => {
      live = false
    }
  }, [])

  const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname)
  const canShare = typeof navigator.share === 'function'

  const copy = async () => {
    if (!(await copyText(url!))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (compact) {
    return (
      <section className="handoff-row">
        <span>Send to another device</span>
        {canShare && url && (
          <button className="btn" onClick={() => navigator.share({ title: usePlanner.getState().missionName, url }).catch(() => {})}>
            Share link
          </button>
        )}
        <button className="btn" disabled={!url} onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </section>
    )
  }

  return (
    <section className="handoff">
      <div className="qr">{qr ? <img src={qr} alt="QR code that opens this mission on another device" /> : <span className="qr-wait" />}</div>
      <div className="handoff-text">
        <h3>Open on your phone</h3>
        <p>Scan with the phone that flies the drone. The mission opens there, ready to save into the flight app.</p>
        <p className="fine">For controllers without a camera, send yourself the link instead.</p>
        <div className="handoff-actions">
          {canShare && url && (
            <button className="btn" onClick={() => navigator.share({ title: usePlanner.getState().missionName, url }).catch(() => {})}>
              Share link
            </button>
          )}
          <button
            className="btn"
            disabled={!url}
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {local && <p className="error">This app is running on localhost, so other devices can't open the link. Open it using this computer's network address, or a hosted copy.</p>}
      </div>
    </section>
  )
}

export function SendDialog({ mission }: { mission: Mission }) {
  const drone = useCurrentDrone()
  const close = () => usePlanner.getState().setSendOpen(false)
  const [sent, setSent] = useState<ExportTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Phones/tablets most likely ARE the flight device, so lead with saving; desktops lead with the QR.
  const touch = window.matchMedia('(pointer: coarse)').matches

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
      {drone.exportTargets.includes('djifly') && <ControllerSend mission={mission} drone={drone} />}
      {!touch && <HandOff />}
      <h3 className="section-title">{touch ? `Save for ${drone.name}` : `Or save it on this device for ${drone.name}`}</h3>
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
      {touch && <HandOff compact />}
      <label className="file-check">
        <span>Check a mission file on the map</span>
        <input
          type="file"
          accept=".kmz"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            try {
              usePlanner.getState().setInspected({ read: await readKmz(file), source: `File: ${file.name}` })
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            }
          }}
        />
      </label>
      <p className="fine">Always check the route in the flight app before take-off. You are responsible for every flight.</p>
    </Dialog>
  )
}
