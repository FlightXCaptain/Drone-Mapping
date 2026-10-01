import { area as turfArea, polygon as turfPolygon } from '@turf/turf'
import { planGrid } from './domain/planners/grid'
import { planOrbit, ringRadius } from './domain/planners/orbit'
import { combineMissions } from './domain/combine'
import { missionStats } from './domain/stats'
import type { DroneProfile, LngLat, Mission, MissionStats } from './domain/types'
import type { Part } from './store'

export interface PlannedPart {
  part: Part
  mission: Mission
  areaM2: number | null
  /** Camera-to-surface distance for GSD: altitude for grids, slant range for orbits. */
  cameraDistanceM: number
}

export function planPart(part: Part, drone: DroneProfile, name: string, arriveFrom?: LngLat): PlannedPart | null {
  if (part.missionType === 'grid') {
    if (!part.area || part.area.length < 4) return null
    // Unless the user placed Start themselves, enter at the corner nearest where the drone arrives from.
    const grid = !part.grid.startNear && arriveFrom ? { ...part.grid, startNear: arriveFrom } : part.grid
    return {
      part,
      mission: planGrid(part.area, drone, grid, name),
      areaM2: turfArea(turfPolygon([part.area])),
      cameraDistanceM: part.grid.altitudeM,
    }
  }
  if (!part.orbitCenter) return null
  const o = part.orbit
  const slant =
    o.rings.reduce((sum, r) => sum + Math.hypot(ringRadius(r, o), r.altitudeM - part.subjectHeightM / 2), 0) /
    Math.max(1, o.rings.length)
  return { part, mission: planOrbit(part.orbitCenter, drone, o, name), areaM2: null, cameraDistanceM: slant }
}

export interface PlannedMission {
  mission: Mission | null
  stats: MissionStats | null
  /** The part being edited, planned on its own (for its Start pin and drag hit-area). */
  active: PlannedPart | null
}

export function planAll(parts: Part[], activeId: string, drone: DroneProfile, name: string): PlannedMission {
  const planned: PlannedPart[] = []
  for (const p of parts) {
    const planned1 = planPart(p, drone, name, planned.at(-1)?.mission.waypoints.at(-1)?.position)
    if (planned1) planned.push(planned1)
  }
  if (planned.length === 0) return { mission: null, stats: null, active: null }
  const active = planned.find((p) => p.part.id === activeId) ?? null
  const mission = combineMissions(
    planned.map((p) => p.mission),
    name,
    drone.id,
  )
  const areas = planned.map((p) => p.areaM2).filter((a): a is number => a !== null)
  const stats = missionStats(
    mission,
    drone,
    areas.length ? areas.reduce((a, b) => a + b, 0) : null,
    (active ?? planned[0]).cameraDistanceM,
  )
  return { mission, stats, active }
}
