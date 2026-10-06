import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog } from './Dialog'
import {
  engineCancel,
  engineInstall,
  engineRemove,
  engineStatus,
  hardwareInfo,
  jobCancel,
  jobDelete,
  jobExport,
  pickSaveFolder,
  jobOpen,
  jobStart,
  jobsList,
  onEngineProgress,
  onImportProgress,
  onJobProgress,
  photosImport,
  photosScan,
  pickFolder,
  tileUrl,
  type EngineProgress,
  type EngineStatus,
  type Job,
  type JobKind,
  type JobProgress,
  type PhotoScan,
  type PhotoSource,
  type Quality,
} from '../bridge'
import { coverage } from '../domain/coverage'
import { groupFlights } from '../domain/flights'
import { mapFit, splatFit, type Fit, type Hardware } from '../domain/hardware'
import { useProcessingView } from '../processing'
import type { LngLat } from '../domain/types'
import type { ViewerModel } from './ModelViewer'

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)
const KIND: Record<JobKind, { label: string; pack: string }> = {
  map: { label: 'Photogrammetry model', pack: 'photogrammetry' },
  splat: { label: 'Gaussian splat model', pack: 'splats' },
}
const QUALITY: [Quality, string, string][] = [
  ['fast', 'Fast', 'Quick check on site: lower detail'],
  ['standard', 'Standard', 'Good detail for most jobs'],
  ['high', 'High', 'Most detail; can take several times longer'],
]
const RATING: Record<Fit['rating'], string> = { good: 'Good', ok: 'OK', slow: 'Slow', no: 'Not suitable' }
const when = (s: number) => new Date(s * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const took = (s?: number) => (s == null ? '' : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)

/**
 * Turn the photos from a flight into results on this PC: check coverage against the plan,
 * run OpenDroneMap or COLMAP + Brush, and show or open what they made. Desktop app only.
 */
export function ProcessingDialog({
  onClose,
  planned,
  missionName,
  startWith,
  onView,
}: {
  onClose: () => void
  /** Open a finished model or splat in the 3D viewer. */
  onView: (m: ViewerModel) => void
  planned: LngLat[]
  missionName: string
  /** A connected card or device to load straight away (from the "photos found" prompt). */
  startWith?: PhotoSource | null
}) {
  const view = useProcessingView()
  const [engines, setEngines] = useState<EngineStatus | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [scan, setScan] = useState<PhotoScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [name, setName] = useState(missionName)
  const [quality, setQuality] = useState<Quality>('standard')
  const [progress, setProgress] = useState<Record<string, JobProgress>>({})
  const [installing, setInstalling] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<EngineProgress | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: string; text: string } | null>(null)
  const [hw, setHw] = useState<Hardware | null>(null)
  const [flightIdx, setFlightIdx] = useState(0)
  const [importing, setImporting] = useState<{ id: string; done: number; total: number } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [e, j] = await Promise.all([engineStatus(), jobsList()])
      setEngines(e)
      setJobs(j.jobs)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    hardwareInfo().then(setHw, () => {})
    const stops: (() => void)[] = []
    let gone = false
    const keep = (u: () => void) => (gone ? u() : stops.push(u))
    onEngineProgress(setInstallProgress).then(keep)
    onImportProgress((p) => setImporting((i) => (i ? { ...i, ...p } : i))).then(keep)
    onJobProgress((p) => {
      setProgress((all) => ({ ...all, [p.id]: p }))
      if (['done', 'failed', 'cancelled'].includes(p.stage)) void refresh()
    }).then(keep)
    return () => {
      gone = true
      stops.forEach((u) => u())
    }
  }, [refresh])

  const installed = (pack: string) => !!engines?.packs.find((p) => p.id === pack)?.installed
  const running = jobs.find((j) => j.status === 'running')
  // A card holds many flights: work on one at a time (newest first).
  const flights = useMemo(() => groupFlights(scan?.photos ?? []), [scan])
  const photos = useMemo(() => flights[flightIdx]?.photos ?? [], [flights, flightIdx])
  const cover = useMemo(
    () => (photos.length && planned.length ? coverage(planned, photos.map((p) => [p.lng, p.lat] as LngLat)) : null),
    [photos, planned],
  )
  useEffect(() => {
    if (!scan) return
    view.setPhotos({ taken: photos.map((p) => [p.lng, p.lat] as LngLat), missing: cover?.missing ?? [] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, cover])

  const [typed, setTyped] = useState('')
  const choose = async (given?: string) => {
    setError(null)
    const folder = given ?? (await pickFolder())
    if (!folder) return
    setScanning(true)
    try {
      const r = await photosScan(folder)
      if (!r.ok) throw new Error(r.error)
      setFlightIdx(0)
      setScan(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setScanning(false)
  }

  /** A card or drive is read in place; a DJI USB device is imported to Documents first. */
  const takeSource = async (s: PhotoSource) => {
    view.markSeen(s.id)
    if (s.kind === 'drive' && s.path) return choose(s.path)
    setError(null)
    setImporting({ id: s.id, done: 0, total: s.photos })
    try {
      const r = await photosImport(s)
      if (!r.ok || !r.folder) throw new Error(r.error ?? 'The import failed.')
      setImporting(null)
      await choose(r.folder)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setImporting(null)
  }

  // Opened from the "photos found" prompt: start with that source, once.
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (!startWith || started) return
    setStarted(true)
    void takeSource(startWith)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith, started])

  const start = async (kind: JobKind) => {
    if (!photos.length) return
    setError(null)
    const r = await jobStart(kind, name.trim() || 'Photos', photos.map((p) => p.path), quality)
    if (!r.ok) setError(r.error ?? 'Could not start.')
    void refresh()
  }

  const showMap = async (job: Job) => {
    if (view.overlay?.id === job.id) return view.setOverlay(null)
    if (!job.outputs?.tiles || !job.bounds) return setError('This result has no map tiles to show.')
    view.setOverlay({ id: job.id, tiles: await tileUrl(job.outputs.tiles), bounds: job.bounds })
  }

  const open = async (job: Job, what: 'folder' | 'model' | 'orthophoto' | 'splat') => {
    const r = await jobOpen(job.id, what)
    if (!r.ok) setError(r.error ?? 'Could not open it.')
  }

  /** Copy the deliverables (map, model, point cloud, splat) wherever the user wants them. */
  const save = async (job: Job) => {
    setError(null)
    setSaved(null)
    const dest = await pickSaveFolder()
    if (!dest) return
    setSaved({ id: job.id, text: 'Saving…' })
    const r = await jobExport(job.id, dest)
    if (!r.ok) {
      setSaved(null)
      return setError(r.error ?? 'Could not save the files.')
    }
    setSaved({ id: job.id, text: `Saved ${r.files} files (${gb(r.bytes ?? 0)}) to ${r.folder}` })
  }

  const install = async (id: string, action: 'install' | 'remove') => {
    setInstalling(id)
    setError(null)
    setInstallProgress(null)
    try {
      const r = action === 'install' ? await engineInstall(id) : await engineRemove(id)
      if (!r.ok) setError(r.error ?? 'Something went wrong.')
    } catch (err) {
      setError(String(err))
    }
    setInstalling(null)
    setInstallProgress(null)
    void refresh()
  }

  const allInstalled = !!engines?.packs.every((p) => p.installed && p.upToDate)

  return (
    <Dialog title="Process photos" onClose={onClose} onMinimise={onClose}>
      <p className="dialog-lede">
        Turn the photos from a flight into a map, a 3D model or a Gaussian splat, here on this PC.
      </p>

      <section className="proc-step">
        <h3>1. Your photos</h3>
        {view.sources.length > 0 && (
          <ul className="sources" aria-label="Connected cards and drones">
            {view.sources.map((s) => (
              <li key={s.id}>
                <span>
                  <b>{s.label}</b> · {s.photos.toLocaleString()} photos
                </span>
                {importing?.id === s.id ? (
                  <span className="source-import">
                    <progress max={importing.total || 1} value={importing.done} /> {importing.done} of {importing.total}
                  </span>
                ) : (
                  <button className="btn" disabled={!!importing || scanning} onClick={() => takeSource(s)}>
                    {s.kind === 'mtp' ? 'Import' : 'Use'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={() => choose()} disabled={scanning}>
            {scanning ? 'Reading photos…' : scan ? 'Choose another folder' : 'Choose photo folder'}
          </button>
          <input
            className="input proc-path"
            placeholder="or paste a folder path, e.g. E:\DCIM\100MEDIA"
            aria-label="Photo folder path"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && typed.trim() && choose(typed.trim().replace(/^"|"$/g, ''))}
          />
        </div>
        {scan && <span className="fine proc-folder" title={scan.folder}>{scan.folder}</span>}
        {flights.length > 1 && (
          <label className="stack">
            Flight
            <select className="input" value={flightIdx} onChange={(e) => setFlightIdx(Number(e.target.value))}>
              {flights.map((f, i) => (
                <option key={f.start} value={i}>
                  {f.start ? new Date(f.start).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Undated'} ·{' '}
                  {f.photos.length} photos
                </option>
              ))}
            </select>
          </label>
        )}
        {scan && (
          <ul className="proc-facts">
            <li>
              <b>{photos.length}</b> photos with GPS (green on the map)
              {scan.noGps.length > 0 && `; ${scan.noGps.length} without GPS will be skipped`}
            </li>
            {cover && (
              <li className={cover.missing.length ? 'warn-text' : 'ok-text'}>
                {cover.found} of {planned.length} planned shots taken
                {cover.missing.length ? `: ${cover.missing.length} missing (red on the map)` : ': full coverage'}
              </li>
            )}
            {cover && cover.unplanned > 0 && <li>{cover.unplanned} photos away from the current plan</li>}
          </ul>
        )}
      </section>

      <section className="proc-step">
        <h3>2. Make</h3>
        <label className="stack">
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="choice" role="radiogroup" aria-label="Quality">
          {QUALITY.map(([q, label, title]) => (
            <button key={q} role="radio" aria-checked={quality === q} className={quality === q ? 'on' : ''} title={title} onClick={() => setQuality(q)}>
              {label}
            </button>
          ))}
        </div>
        {hw && (
          <ul className="fit" aria-label="How well this PC will cope">
            {(['map', 'splat'] as JobKind[]).map((k) => {
              const fit = k === 'map' ? mapFit(hw, photos.length, quality) : splatFit(hw, photos.length, quality)
              return (
                <li key={k}>
                  <span className={`fit-badge fit-${fit.rating}`}>{RATING[fit.rating]}</span>
                  <span>
                    <b>{KIND[k].label}:</b> {fit.message}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <div className="proc-make">
          {(['map', 'splat'] as JobKind[]).map((k) => (
            <button
              key={k}
              className="btn btn-primary"
              disabled={photos.length < 5 || !!running || !installed(KIND[k].pack)}
              title={!installed(KIND[k].pack) ? 'Install its processing tools first (below)' : undefined}
              onClick={() => start(k)}
            >
              {KIND[k].label}
            </button>
          ))}
        </div>
        {!scan && <p className="fine">Choose the photos first.</p>}
        {running && (
          <p className="fine">
            One job runs at a time.{' '}
            <button className="link-btn" onClick={onClose}>
              Minimise
            </button>{' '}
            to use the map while it runs; its progress shows in the bottom bar.
          </p>
        )}
      </section>

      {jobs.length > 0 && (
        <section className="proc-step">
          <h3>Results</h3>
          <ul className="jobs">
            {jobs.map((j) => {
              const p = progress[j.id]
              return (
                <li key={j.id} className={`job job-${j.status}`}>
                  <div className="job-head">
                    <b>{j.name}</b>
                    <span className="fine">
                      {KIND[j.kind].label} · {j.photos} photos · {when(j.startedAt)}
                      {j.status === 'done' && ` · took ${took(j.seconds)}`}
                    </span>
                  </div>
                  {j.status === 'running' ? (
                    <div className="pack-progress">
                      <progress max={100} value={p?.pct ?? undefined} />
                      <span>
                        {p?.stage ?? j.stage}
                        {p ? ` · ${Math.round(p.pct)}%` : ''}
                      </span>
                      <button className="btn" onClick={() => jobCancel(j.id)}>
                        Cancel
                      </button>
                      {p?.line && <code className="job-line">{p.line}</code>}
                    </div>
                  ) : (
                    <div className="dialog-actions job-actions">
                      {j.status === 'done' && j.kind === 'map' && (
                        <>
                          <button className={`btn ${view.overlay?.id === j.id ? 'btn-primary' : ''}`} onClick={() => showMap(j)}>
                            {view.overlay?.id === j.id ? 'Hide map' : 'Show on map'}
                          </button>
                          {j.outputs?.model && (
                            <button className="btn" onClick={() => onView({ title: j.name, kind: 'mesh', path: j.outputs!.model! })}>
                              View 3D model
                            </button>
                          )}
                        </>
                      )}
                      {j.status === 'done' && j.kind === 'splat' && (
                        <button className="btn btn-primary" onClick={() => onView({ title: j.name, kind: 'splat', path: j.outputs!.splat! })}>
                          View splat
                        </button>
                      )}
                      {j.status === 'done' && j.kind === 'splat' && (
                        <button className="btn" onClick={() => open(j, 'splat')} title="Open in Brush, the splat trainer's own viewer">
                          Open in Brush
                        </button>
                      )}
                      {j.status !== 'done' && (
                        <span className="error job-error">
                          {j.status === 'failed' ? j.error : j.status === 'cancelled' ? 'Cancelled' : 'Stopped when the app closed'}
                        </span>
                      )}
                      {j.status === 'done' && (
                        <button className="btn" onClick={() => save(j)} title="Copy the finished files somewhere else, e.g. to send to a client">
                          Save files…
                        </button>
                      )}
                      <button className="btn" onClick={() => open(j, 'folder')}>
                        Folder
                      </button>
                      <span className="spacer" />
                      <button
                        className="btn btn-danger"
                        onClick={async () => {
                          if (confirmDelete !== j.id) return setConfirmDelete(j.id)
                          setConfirmDelete(null)
                          if (view.overlay?.id === j.id) view.setOverlay(null)
                          const r = await jobDelete(j.id)
                          if (!r.ok) setError(r.error ?? 'Could not delete it.')
                          void refresh()
                        }}
                      >
                        {confirmDelete === j.id ? 'Really delete?' : 'Delete'}
                      </button>
                    </div>
                  )}
                  {saved?.id === j.id && <p className="fine job-saved">{saved.text}</p>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {error && <p className="error">{error}</p>}

      <details className="proc-step" open={!allInstalled}>
        <summary>
          <h3>Processing tools</h3>
        </summary>
        <p className="fine">Free, open-source tools, downloaded once. App updates keep them.</p>
        <div className="packs">
          {engines?.packs.map((p) => {
            const mine = installing === p.id
            const pct =
              mine && installProgress && installProgress.total ? Math.min(100, (installProgress.done / installProgress.total) * 100) : null
            const lowDisk = engines.freeBytes != null && engines.freeBytes < p.downloadBytes + p.installedBytes
            return (
              <section key={p.id} className={`pack ${p.installed ? 'pack-on' : ''}`}>
                <div className="pack-head">
                  <h3>{p.title}</h3>
                  <span className="pack-state">{p.installed ? (p.upToDate ? 'Installed' : 'Update available') : 'Not installed'}</span>
                </div>
                <p className="pack-sum">{p.summary}</p>
                {mine ? (
                  <div className="pack-progress">
                    <progress max={100} value={pct ?? undefined} />
                    <span>
                      {installProgress?.message ?? 'Starting…'}
                      {installProgress?.total && installProgress.total > 1
                        ? ` · ${gb(installProgress.done)} of ${gb(installProgress.total)}`
                        : ''}
                    </span>
                    {(!installProgress || installProgress.step === 'download') && (
                      <button className="btn" onClick={() => engineCancel()}>
                        Cancel
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="dialog-actions">
                    <span className="fine">
                      {p.installed ? `Uses about ${gb(p.installedBytes)}` : `${gb(p.downloadBytes)} download · about ${gb(p.installedBytes)} on disk`}
                    </span>
                    <span className="spacer" />
                    {p.installed && (
                      <button className="btn btn-danger" disabled={!!installing || !!running} onClick={() => install(p.id, 'remove')}>
                        Remove
                      </button>
                    )}
                    {(!p.installed || !p.upToDate) && (
                      <button
                        className="btn btn-primary"
                        disabled={!!installing || !engines.windows || lowDisk}
                        title={lowDisk ? 'Not enough free disk space' : undefined}
                        onClick={() => install(p.id, 'install')}
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
        {engines?.freeBytes != null && <p className="fine">{gb(engines.freeBytes)} free on this drive.</p>}
        <p className="fine">
          Downloads come from each tool's official GitHub release and are checked against a fixed fingerprint before
          installing. Splats train on the graphics card, so a gaming or workstation GPU is much faster.
        </p>
      </details>
    </Dialog>
  )
}
