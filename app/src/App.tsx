import { useEffect, useMemo, useState } from 'react'
import { MapView, type Basemap } from './components/MapView'
import { ControlCard } from './components/ControlCard'
import { Toolbar } from './components/Toolbar'
import { StatsBar } from './components/StatsBar'
import { SendDialog } from './components/SendDialog'
import { DroneEditor } from './components/DroneEditor'
import { PlaceSearch } from './components/PlaceSearch'
import { SharedPlanPrompt } from './components/SharedPlanPrompt'
import { InspectPanel } from './components/InspectPanel'
import { ProcessingDialog } from './components/ProcessingDialog'
import { ModelViewer, type ViewerModel } from './components/ModelViewer'
import { isDesktop, jobsList, onJobProgress, photoSources, type PhotoSource } from './bridge'
import { useProcessingView } from './processing'
import { currentParts, useCurrentDrone, usePlanner } from './store'
import { planAll } from './plan'
import type { LngLat } from './domain/types'
import './App.css'

export default function App() {
  const drone = useCurrentDrone()
  const s = usePlanner()
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [flyTo, setFlyTo] = useState<LngLat | null>(null)
  const [processingOpen, setProcessingOpen] = useState(false)
  const [startWith, setStartWith] = useState<PhotoSource | null>(null)
  const [viewing, setViewing] = useState<ViewerModel | null>(null)
  const view = useProcessingView()

  // Watch for cards and DJI devices with photos: drives every few seconds (cheap), DJI USB
  // devices less often (each look starts PowerShell).
  useEffect(() => {
    if (!isDesktop()) return
    let n = 0
    let busy = false
    const look = async () => {
      if (busy) return
      busy = true
      try {
        const r = await photoSources(n++ % 4 === 0)
        const { sources, setSources } = useProcessingView.getState()
        // Keep USB sources found by the slower check between its runs.
        const usb = n % 4 === 1 ? [] : sources.filter((s) => s.kind === 'mtp')
        const merged = [...r.sources, ...usb.filter((u) => !r.sources.some((s) => s.id === u.id))]
        if (JSON.stringify(merged) !== JSON.stringify(sources)) setSources(merged)
      } catch {
        /* not fatal: try again next time */
      }
      busy = false
    }
    void look()
    const t = setInterval(look, 5000)
    return () => clearInterval(t)
  }, [])
  // Offer the source most likely to be the flight: the biggest folder, never DJI's simulator.
  const newSource = view.sources
    .filter((x) => !view.seen.includes(x.id) && !/simulator/i.test(x.label))
    .sort((a, b) => b.photos - a.photos)[0]

  // Follow processing jobs app-wide, so progress shows in the bottom bar with the window closed.
  useEffect(() => {
    if (!isDesktop()) return
    const { setJob, setFinished } = useProcessingView.getState()
    jobsList().then(
      (r) => {
        const j = r.jobs.find((x) => x.status === 'running')
        if (j) setJob({ id: j.id, name: j.name, kind: j.kind, stage: j.stage, pct: 0 })
      },
      () => {},
    )
    let stop: (() => void) | undefined
    let gone = false
    onJobProgress((p) => {
      if (['done', 'failed', 'cancelled'].includes(p.stage)) {
        setJob(null)
        setFinished({ id: p.id, name: p.name, kind: p.kind, status: p.stage })
      } else {
        setJob({ id: p.id, name: p.name, kind: p.kind, stage: p.stage, pct: p.pct })
        setFinished(null)
      }
    }).then((u) => (gone ? u() : (stop = u)))
    return () => {
      gone = true
      stop?.()
    }
  }, [])

  // Re-plan every part on every edit. Planning is pure and takes a few ms, which is what lets
  // dragging a corner or the route feel live.
  const parts = useMemo(
    () => currentParts(s),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.parts, s.activePartId, s.missionType, s.area, s.orbitCenter, s.grid, s.orbit, s.subjectHeightM, s.ringCount],
  )
  const { mission, stats, active } = useMemo(
    () => planAll(parts, s.activePartId, drone, s.missionName),
    [parts, s.activePartId, drone, s.missionName],
  )

  return (
    <div className="app">
      <MapView mission={mission} activeMission={active?.mission ?? null} parts={parts} basemap={basemap} flyTo={flyTo} />

      <div className="top-left">
        <PlaceSearch onPick={(c) => setFlyTo([...c])} />
        <ControlCard />
      </div>

      <div className="basemap choice" role="radiogroup" aria-label="Map style">
        {(
          [
            ['satellite', 'Satellite', 'Most recent Esri imagery'],
            ['clarity', 'Clarity', 'Sharper Esri imagery, sometimes older'],
            ['streets', 'Streets', 'OpenStreetMap'],
          ] as const
        ).map(([b, label, title]) => (
          <button key={b} role="radio" aria-checked={basemap === b} className={basemap === b ? 'on' : ''} title={title} onClick={() => setBasemap(b)}>
            {label}
          </button>
        ))}
      </div>

      {newSource && !processingOpen && (
        <div className="source-prompt" role="status">
          <span>
            <b>{newSource.photos.toLocaleString()} photos</b> found on {newSource.label}
          </span>
          <button
            className="btn btn-primary"
            onClick={() => {
              view.markSeen(newSource.id)
              setStartWith(newSource)
              setProcessingOpen(true)
            }}
          >
            Process
          </button>
          <button
            className="icon-btn"
            aria-label="Dismiss"
            // Dismissing hides every source found so far; a newly plugged-in one still prompts.
            onClick={() => view.sources.forEach((x) => view.markSeen(x.id))}
          >
            ✕
          </button>
        </div>
      )}
      {(view.photos || view.overlay) && (
        <div className="proc-chips">
          {view.photos && (
            <button className="proc-chip" onClick={() => view.setPhotos(null)} title="Hide the photo positions">
              <i className="dot dot-taken" /> {view.photos.taken.length} photos
              {view.photos.missing.length > 0 && (
                <>
                  {' '}
                  <i className="dot dot-missing" /> {view.photos.missing.length} missing
                </>
              )}{' '}
              ✕
            </button>
          )}
          {view.overlay && (
            <button className="proc-chip" onClick={() => view.setOverlay(null)} title="Hide the processed map">
              Processed map ✕
            </button>
          )}
        </div>
      )}

      <div className="bottom">
        <Toolbar />
        <StatsBar
          stats={stats}
          onProcess={
            isDesktop()
              ? () => {
                  view.setFinished(null)
                  setProcessingOpen(true)
                }
              : undefined
          }
        />
      </div>

      {s.sendOpen && mission && <SendDialog mission={mission} />}
      <InspectPanel plan={mission} onFocus={(c) => setFlyTo([...c])} />
      <SharedPlanPrompt onOpened={(c) => c && setFlyTo([...c])} />
      {processingOpen && (
        <ProcessingDialog
          onClose={() => {
            setProcessingOpen(false)
            setStartWith(null)
          }}
          planned={mission?.photoPoints ?? []}
          missionName={s.missionName}
          startWith={startWith}
          onView={(m) => {
            // The processing window is modal (always on top), so step out of it while viewing.
            setProcessingOpen(false)
            setStartWith(null)
            setViewing(m)
          }}
        />
      )}
      {viewing && (
        <ModelViewer
          model={viewing}
          onClose={() => {
            setViewing(null)
            setProcessingOpen(true)
          }}
        />
      )}
      {s.droneEditor && <DroneEditor initial={s.droneEditor === 'new' ? null : s.droneEditor} />}
    </div>
  )
}
