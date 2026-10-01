import { useMemo, useState } from 'react'
import { area as turfArea, polygon as turfPolygon } from '@turf/turf'
import { MapView, type Basemap } from './components/MapView'
import { ControlCard } from './components/ControlCard'
import { Toolbar } from './components/Toolbar'
import { StatsBar } from './components/StatsBar'
import { SendDialog } from './components/SendDialog'
import { DroneEditor } from './components/DroneEditor'
import { PlaceSearch } from './components/PlaceSearch'
import { SharedPlanPrompt } from './components/SharedPlanPrompt'
import { useCurrentDrone, usePlanner } from './store'
import { planGrid } from './domain/planners/grid'
import { planOrbit, ringRadius } from './domain/planners/orbit'
import { missionStats } from './domain/stats'
import type { LngLat } from './domain/types'
import './App.css'

export default function App() {
  const drone = useCurrentDrone()
  const s = usePlanner()
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [flyTo, setFlyTo] = useState<LngLat | null>(null)

  // Re-plan on every edit. Planning is pure and takes a few ms, which is what lets
  // dragging a corner or the route feel live.
  const { mission, stats } = useMemo(() => {
    if (s.missionType === 'grid' && s.area && s.area.length >= 4) {
      const m = planGrid(s.area, drone, s.grid, s.missionName)
      return { mission: m, stats: missionStats(m, drone, turfArea(turfPolygon([s.area]))) }
    }
    if (s.missionType === 'orbit' && s.orbitCenter) {
      const m = planOrbit(s.orbitCenter, drone, s.orbit, s.missionName)
      // GSD at the average slant range from each ring to the subject's mid-height.
      const slant =
        s.orbit.rings.reduce((sum, r) => sum + Math.hypot(ringRadius(r, s.orbit), r.altitudeM - s.subjectHeightM / 2), 0) /
        Math.max(1, s.orbit.rings.length)
      return { mission: m, stats: missionStats(m, drone, null, slant) }
    }
    return { mission: null, stats: null }
  }, [s.missionType, s.area, s.orbitCenter, s.grid, s.orbit, s.subjectHeightM, s.missionName, drone])

  return (
    <div className="app">
      <MapView mission={mission} basemap={basemap} flyTo={flyTo} />

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
