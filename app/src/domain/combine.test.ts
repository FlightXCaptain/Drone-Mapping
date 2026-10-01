import { describe, expect, it } from 'vitest'
import { combineMissions } from './combine'
import { planGrid, defaultGridParams } from './planners/grid'
import { planOrbit, defaultOrbitParams } from './planners/orbit'
import { BUILTIN_DRONES } from './drones'
import type { LngLat } from './types'

const drone = BUILTIN_DRONES[0]
const RECT: LngLat[] = [
  [115.85, -31.95],
  [115.851, -31.95],
  [115.851, -31.9505],
  [115.85, -31.9505],
  [115.85, -31.95],
]
const grid = planGrid(RECT, drone, { ...defaultGridParams, altitudeM: 60 })
const orbit = planOrbit([115.853, -31.951], drone, defaultOrbitParams) // first ring is low

describe('combineMissions', () => {
  const m = combineMissions([grid, orbit], 'Site', drone.id)

  it('keeps every photo from every part', () => {
    expect(m.photoPoints.length).toBe(grid.photoPoints.length + orbit.photoPoints.length)
  })

  it('crosses between parts at the higher height, then descends', () => {
    const gEnd = grid.waypoints.length - 1
    const transit = m.waypoints[gEnd + 1]
    expect(transit.altitudeM).toBe(60)
    expect(transit.position).toEqual(orbit.waypoints[0].position) // cross high, above the next start
    expect(transit.actions).toEqual([])
    expect(m.waypoints[gEnd + 2]).toEqual(orbit.waypoints[0])
  })

  it('re-indexes interval shooting to the combined waypoint list', () => {
    for (const s of m.intervalSegments) {
      expect(m.waypoints[s.startIndex].position).toEqual(grid.waypoints[s.startIndex].position)
    }
    const shifted = combineMissions([orbit, grid], 'Site', drone.id)
    const first = shifted.intervalSegments[0]
    expect(shifted.waypoints[first.startIndex].position).toEqual(grid.waypoints[0].position)
  })

  it('a single part passes straight through', () => {
    expect(combineMissions([grid], 'x', drone.id).waypoints).toEqual(grid.waypoints)
  })
})
