import { useMemo, useState } from 'react'
import { MapView, type Basemap } from './components/MapView'
import { ControlCard } from './components/ControlCard'
import { Toolbar } from './components/Toolbar'
import { StatsBar } from './components/StatsBar'
import { SendDialog } from './components/SendDialog'
import { DroneEditor } from './components/DroneEditor'
import { PlaceSearch } from './components/PlaceSearch'
import { SharedPlanPrompt } from './components/SharedPlanPrompt'
import { currentParts, useCurrentDrone, usePlanner } from './store'
import { planAll } from './plan'
import type { LngLat } from './domain/types'
import './App.css'

export default function App() {
  const drone = useCurrentDrone()
  const s = usePlanner()
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [flyTo, setFlyTo] = useState<LngLat | null>(null)

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

      <div className="bottom">
        <Toolbar />
        <StatsBar stats={stats} />
      </div>

      {s.sendOpen && mission && <SendDialog mission={mission} />}
      <SharedPlanPrompt onOpened={(c) => c && setFlyTo([...c])} />
      {s.droneEditor && <DroneEditor initial={s.droneEditor === 'new' ? null : s.droneEditor} />}
    </div>
  )
}
