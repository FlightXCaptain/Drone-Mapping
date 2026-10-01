import { useMemo } from 'react'
import { area as turfArea, polygon as turfPolygon } from '@turf/turf'
import { MapView } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { useAllDrones, usePlanner } from './store'
import { planGrid } from './domain/planners/grid'
import { planOrbit } from './domain/planners/orbit'
import { missionStats } from './domain/stats'
import './App.css'

export default function App() {
  const drones = useAllDrones()
  const s = usePlanner()
  const drone = drones.find((d) => d.id === s.droneId) ?? drones[0]

  // Re-plan on every edit. Planning is pure and cheap (well under a frame for typical sites),
  // which is what makes dragging a vertex feel live.
  const { mission, stats } = useMemo(() => {
    if (s.missionType === 'grid' && s.area && s.area.length >= 4) {
      const m = planGrid(s.area, drone, s.grid, s.missionName)
      return { mission: m, stats: missionStats(m, drone, turfArea(turfPolygon([s.area]))) }
    }
    if (s.missionType === 'orbit' && s.orbitCenter) {
      const m = planOrbit(s.orbitCenter, drone, s.orbit, s.missionName)
      // Average slant range from each ring to the subject's mid-height.
      const slant =
        s.orbit.rings.reduce((sum, r) => sum + Math.hypot(s.orbit.radiusM, r.altitudeM - s.subjectHeightM / 2), 0) /
        Math.max(1, s.orbit.rings.length)
      return { mission: m, stats: missionStats(m, drone, null, slant) }
    }
    return { mission: null, stats: null }
  }, [s.missionType, s.area, s.orbitCenter, s.grid, s.orbit, s.subjectHeightM, s.missionName, drone])

  return (
    <div className="app">
      <MapView mission={mission} />
      <Sidebar mission={mission} stats={stats} drone={drone} />
    </div>
  )
}
