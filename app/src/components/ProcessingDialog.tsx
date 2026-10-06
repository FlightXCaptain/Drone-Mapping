import { useCallback, useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import {
  engineCancel,
  engineInstall,
  engineRemove,
  engineStatus,
  onEngineProgress,
  type EngineProgress,
  type EngineStatus,
} from '../bridge'

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)

/**
 * Optional processing packs for turning flight photos into maps, 3D models and splats.
 * Desktop app only: they're downloaded on request so the installer itself stays small.
 */
export function ProcessingDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<EngineProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await engineStatus())
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
    let stop: (() => void) | undefined
    let gone = false
    onEngineProgress(setProgress).then((u) => (gone ? u() : (stop = u)))
    return () => {
      gone = true
      stop?.()
    }
  }, [refresh])

  const run = async (id: string, action: 'install' | 'remove') => {
    setBusy(id)
    setError(null)
    setProgress(null)
    try {
      const r = action === 'install' ? await engineInstall(id) : await engineRemove(id)
      if (!r.ok) setError(r.error ?? 'Something went wrong.')
    } catch (e) {
      setError(String(e))
    }
    setBusy(null)
    setProgress(null)
    refresh()
  }

  return (
    <Dialog title="Processing tools" onClose={onClose}>
      <p className="dialog-lede">
        Turn the photos from a flight into maps, 3D models and Gaussian splats on this PC. These are free, open-source
        tools. Install the ones you need; app updates keep them.
      </p>
      {status && !status.windows && <p className="error">Processing tools need Windows.</p>}
      <div className="packs">
        {status?.packs.map((p) => {
          const mine = busy === p.id
          const pct = mine && progress && progress.total ? Math.min(100, (progress.done / progress.total) * 100) : null
          const lowDisk = status.freeBytes != null && status.freeBytes < p.downloadBytes + p.installedBytes
          return (
            <section key={p.id} className={`pack ${p.installed ? 'pack-on' : ''}`}>
              <div className="pack-head">
                <h3>{p.title}</h3>
                <span className="pack-state">
                  {p.installed ? (p.upToDate ? 'Installed' : 'Update available') : 'Not installed'}
                </span>
              </div>
              <p className="pack-sum">{p.summary}</p>
              {mine ? (
                <div className="pack-progress">
                  <progress max={100} value={pct ?? undefined} />
                  <span>
                    {progress?.message ?? 'Starting…'}
                    {progress?.step === 'download' && progress.total
                      ? ` · ${gb(progress.done)} of ${gb(progress.total)}`
                      : ''}
                  </span>
                  {(!progress || progress.step === 'download') && (
                    <button className="btn" onClick={() => engineCancel()}>
                      Cancel
                    </button>
                  )}
                </div>
              ) : (
                <div className="dialog-actions">
                  <span className="fine">
                    {p.installed
                      ? `Uses about ${gb(p.installedBytes)}`
                      : `${gb(p.downloadBytes)} download · about ${gb(p.installedBytes)} on disk`}
                  </span>
                  <span className="spacer" />
                  {p.installed && (
                    <button className="btn btn-danger" disabled={!!busy} onClick={() => run(p.id, 'remove')}>
                      Remove
                    </button>
                  )}
                  {(!p.installed || !p.upToDate) && (
                    <button
                      className="btn btn-primary"
                      disabled={!!busy || !status.windows || lowDisk}
                      title={lowDisk ? 'Not enough free disk space' : undefined}
                      onClick={() => run(p.id, 'install')}
                    >
                      {p.installed ? 'Update' : 'Install'}
                    </button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {error && <p className="error">{error}</p>}
      {status?.freeBytes != null && <p className="fine">{gb(status.freeBytes)} free on this drive.</p>}
      <p className="fine">
        Installing downloads the tools from their official GitHub releases and checks each file's fingerprint before
        using it. The splat trainer needs a reasonably modern graphics card.
      </p>
    </Dialog>
  )
}
