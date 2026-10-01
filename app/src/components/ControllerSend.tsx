import { useCallback, useEffect, useState } from 'react'
import { buildKmz } from '../export/wpml'
import { readKmz } from '../export/readWpml'
import { usePlanner } from '../store'
import { rcFetch, rcList, rcSend } from '../bridge'
import type { DroneProfile, Mission } from '../domain/types'

interface RcMission {
  id: string
  waypoints: number | string
}
type Status =
  | { kind: 'checking' }
  | { kind: 'unavailable' } // app not served from the bridge (e.g. hosted copy, or opened from another device)
  | { kind: 'absent'; error: string }
  | { kind: 'ready'; device: string; missions: RcMission[]; readAt: number }

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/**
 * One-click "send to the controller plugged into this PC" for DJI Fly, via bridge.ts (built-in
 * in the desktop app, the dev-server bridge in a browser). Hides itself when there's no route.
 */
export function ControllerSend({ mission, drone }: { mission: Mission; drone: DroneProfile }) {
  const [status, setStatus] = useState<Status>({ kind: 'checking' })
  const [slot, setSlot] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // What we last put on the controller, to notice if DJI Fly writes its cached copy back over it.
  const [sent, setSent] = useState<{ mission: string; waypoints: number; at: number } | null>(null)

  const check = useCallback(async () => {
    setStatus({ kind: 'checking' })
    try {
      const body = await rcList()
      if (!body) return setStatus({ kind: 'unavailable' })
      if (!body.ok) return setStatus({ kind: 'absent', error: body.error ?? '' })
      const missions = body.missions as RcMission[]
      setStatus({ kind: 'ready', device: body.device as string, missions, readAt: Date.now() })
      setSlot((s) => (missions.some((m) => m.id === s) ? s : (missions[0]?.id ?? '')))
    } catch {
      setStatus({ kind: 'unavailable' })
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  const [checking, setChecking] = useState(false)
  async function inspect() {
    setChecking(true)
    setResult(null)
    try {
      const body = await rcFetch(slot)
      if (!body.ok) throw new Error(body.error)
      const bytes = Uint8Array.from(atob(body.kmzBase64 as string), (c) => c.charCodeAt(0))
      const read = await readKmz(bytes.buffer)
      const idx = status.kind === 'ready' ? status.missions.findIndex((m) => m.id === slot) + 1 : 0
      usePlanner.getState().setInspected({ read, source: `On ${status.kind === 'ready' ? status.device : 'the controller'}, mission ${idx}, read just now` })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setChecking(false)
    }
  }

  async function send() {
    setSending(true)
    setResult(null)
    try {
      const kmz = await buildKmz(mission, drone, 'djifly')
      const body = await rcSend(await toBase64(kmz), slot)
      setResult(
        body.ok
          ? { ok: true, text: `Sent and verified: ${body.waypoints} waypoints are now in that mission. The old version is backed up on this PC.` }
          : { ok: false, text: body.error ?? 'Send failed.' },
      )
      if (body.ok) {
        setSent({ mission: body.mission as string, waypoints: body.waypoints as number, at: Date.now() })
        check() // refresh the list so counts are current
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  if (status.kind === 'unavailable') return null

  // Only a read taken AFTER the send can show DJI Fly overwriting it; an older list is just stale.
  const now = status.kind === 'ready' && sent && status.readAt > sent.at ? status.missions.find((m) => m.id === sent.mission) : undefined
  const overwritten = !!now && Number(now.waypoints) !== sent!.waypoints

  return (
    <section className="controller">
      <h3>Send straight to the controller</h3>
      {status.kind === 'checking' && <p className="fine">Looking for a controller…</p>}
      {status.kind === 'absent' && (
        <>
          <p className="fine">Plug your DJI RC 2 (or phone) into this PC, switch it on, and close DJI Fly.</p>
          <button className="btn" onClick={check}>
            Check again
          </button>
        </>
      )}
      {status.kind === 'ready' && (
        <>
          <p className="fine">
            <strong>{status.device}</strong> is connected. Close DJI Fly on it, then choose which saved DJI Fly mission to replace.
          </p>
          <div className="controller-row">
            <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Placeholder mission to replace">
              {status.missions.map((m, i) => (
                <option key={m.id} value={m.id}>
                  Mission {i + 1} ({m.waypoints} waypoints now)
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={!slot || sending} onClick={send}>
              {sending ? 'Sending…' : `Send to ${status.device}`}
            </button>
          </div>
          <button className="btn" disabled={!slot || checking || sending} onClick={inspect}>
            {checking ? 'Reading the controller…' : 'Check what’s on the controller'}
          </button>
          {status.missions.length === 1 && (
            <p className="fine">Tip: save a few short missions in DJI Fly to use as slots, so a new send doesn't replace your only one.</p>
          )}
        </>
      )}
      {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
      {result?.ok && !overwritten && (
        <ol className="fine steps-inline">
          <li>Unplug and <strong>restart the controller</strong> (hold the power button, then Restart). DJI Fly keeps missions cached and can write its old copy back if it was still running.</li>
          <li>Open DJI Fly and open the mission. Its thumbnail still shows the old route; that's normal.</li>
          <li>
            Before take-off, <button className="text-btn" onClick={check}>check the controller</button> still holds {sent?.waypoints} waypoints.
          </li>
        </ol>
      )}
      {overwritten && (
        <p className="error">
          DJI Fly has replaced the mission with its cached copy ({now!.waypoints} waypoints). Restart the controller so DJI Fly is fully closed,
          plug it back in, and send again.
        </p>
      )}
    </section>
  )
}
