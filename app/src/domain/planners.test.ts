import { describe, expect, it } from 'vitest'
import { altitudeForGsd, gsdCm, gridSpacing } from './photogrammetry'
import { planGrid, defaultGridParams, sweepLines } from './planners/grid'
import { autoRings, planOrbit, defaultOrbitParams } from './planners/orbit'
import { distanceM } from './geo'
import { BUILTIN_DRONES } from './drones'
import type { LngLat } from './types'

const drone = BUILTIN_DRONES[0]

// ~200 m x 100 m rectangle near Perth (closed ring).
const RECT: LngLat[] = [
  [115.85, -31.95],
  [115.85212, -31.95],
  [115.85212, -31.9509],
  [115.85, -31.9509],
  [115.85, -31.95],
]

describe('photogrammetry', () => {
  it('altitudeForGsd inverts gsdCm', () => {
    expect(gsdCm(drone.camera, altitudeForGsd(drone.camera, 2))).toBeCloseTo(2, 6)
  })

  it('higher overlap → tighter spacing', () => {
    const lo = gridSpacing(drone.camera, 60, 0.6, 0.6)
    const hi = gridSpacing(drone.camera, 60, 0.85, 0.8)
    expect(hi.lineSpacingM).toBeLessThan(lo.lineSpacingM)
    expect(hi.photoSpacingM).toBeLessThan(lo.photoSpacingM)
  })
})

describe('grid planner', () => {
  it('east-west lines span the rectangle plus overshoot', () => {
    const lines = sweepLines(RECT, 20, 90, 10)
    const width = distanceM(RECT[0], RECT[1])
    expect(lines.length).toBe(Math.ceil(distanceM(RECT[1], RECT[2]) / 20))
    for (const [a, b] of lines) expect(distanceM(a, b)).toBeCloseTo(width + 20, 0)
  })

  it('alternates line direction (boustrophedon)', () => {
    const lines = sweepLines(RECT, 20, 90, 0)
    expect(lines[0][0][0]).toBeLessThan(lines[0][1][0]) // west → east
    expect(lines[1][0][0]).toBeGreaterThan(lines[1][1][0]) // east → west
  })

  it('interval mode: 2 waypoints and 1 interval segment per line', () => {
    const m = planGrid(RECT, drone, defaultGridParams)
    expect(m.waypoints.length).toBe(m.intervalSegments.length * 2)
    expect(m.photoPoints.length).toBeGreaterThan(m.waypoints.length)
  })

  it('waypoint mode: one takePhoto waypoint per photo', () => {
    const m = planGrid(RECT, drone, { ...defaultGridParams, triggerMode: 'waypoint' })
    expect(m.waypoints.length).toBe(m.photoPoints.length)
    expect(m.waypoints.every((w) => w.actions.some((a) => a.type === 'takePhoto'))).toBe(true)
  })

  it('crosshatch roughly doubles the work', () => {
    const single = planGrid(RECT, drone, defaultGridParams)
    const cross = planGrid(RECT, drone, { ...defaultGridParams, crosshatch: true })
    expect(cross.intervalSegments.length).toBeGreaterThan(single.intervalSegments.length)
  })
})

describe('orbit planner', () => {
  it('places every photo at the requested radius, aimed at the subject', () => {
    const c: LngLat = [115.85, -31.95]
    const m = planOrbit(c, drone, defaultOrbitParams)
    expect(m.waypoints.length).toBe(defaultOrbitParams.rings.length * defaultOrbitParams.photosPerRing)
    for (const w of m.waypoints) {
      expect(distanceM(c, w.position)).toBeCloseTo(defaultOrbitParams.radiusM, 0)
      expect(w.poi).toEqual(c)
    }
  })

  it('autoRings climbs and pitches progressively further down', () => {
    const rings = autoRings(20, 30, 4)
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i].altitudeM).toBeGreaterThan(rings[i - 1].altitudeM)
      expect(rings[i].gimbalPitchDeg).toBeLessThanOrEqual(rings[i - 1].gimbalPitchDeg)
    }
  })
})

describe('route start', () => {
  it('grid starts at the entry corner nearest startNear', () => {
    for (const corner of RECT.slice(0, 4)) {
      const m = planGrid(RECT, drone, { ...defaultGridParams, overshootM: 0, startNear: corner })
      expect(distanceM(m.waypoints[0].position, corner)).toBeLessThan(40)
    }
  })

  it('orbit starts at startBearingDeg', () => {
    const c: LngLat = [115.85, -31.95]
    const m = planOrbit(c, drone, { ...defaultOrbitParams, startBearingDeg: 90 })
    expect(m.waypoints[0].position[0]).toBeGreaterThan(c[0]) // east of centre
    expect(m.waypoints[0].position[1]).toBeCloseTo(c[1], 5)
  })
})
