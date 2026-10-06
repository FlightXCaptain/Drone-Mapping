import { useMemo, useState } from 'react'
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
import { isDesktop } from './bridge'
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

      {isDesktop() && (
        <button className="tools-btn" onClick={() => setProcessingOpen(true)} title="Install tools that turn flight photos into maps, 3D models and splats">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          Processing
        </button>
      )}

      <div className="bottom">
        <Toolbar />
        <StatsBar stats={stats} />
      </div>

      {s.sendOpen && mission && <SendDialog mission={mission} />}
      <InspectPanel plan={mission} onFocus={(c) => setFlyTo([...c])} />
      <SharedPlanPrompt onOpened={(c) => c && setFlyTo([...c])} />
      {processingOpen && <ProcessingDialog onClose={() => setProcessingOpen(false)} />}
      {s.droneEditor && <DroneEditor initial={s.droneEditor === 'new' ? null : s.droneEditor} />}
    </div>
  )
}
