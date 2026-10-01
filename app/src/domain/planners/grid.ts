import { localFrame, rotate, centroid, distanceM } from '../geo'
import { gridSpacing } from '../photogrammetry'
import type { DroneProfile, LngLat, Mission, Waypoint } from '../types'

export type TriggerMode =
  /** Waypoints only at line ends; camera fires every N metres (smooth, few waypoints). */
  | 'interval'
  /** A waypoint with a takePhoto action at every photo position (works on any app). */
  | 'waypoint'

export interface GridParams {
  altitudeM: number
  frontOverlap: number // 0–1
  sideOverlap: number // 0–1
  /** Flight-line bearing, degrees clockwise from north. */
  angleDeg: number
  speedMs: number
  gimbalPitchDeg: number
  /** Fly a second pass at 90° – recommended for 3D/oblique captures. */
  crosshatch: boolean
  /** Extend each line past the polygon so the aircraft is at speed and level before shooting. */
  overshootM: number
  triggerMode: TriggerMode
  /** Begin the route at whichever valid entry corner is closest to this point (e.g. take-off spot). */
  startNear: LngLat | null
}

export const defaultGridParams: GridParams = {
  altitudeM: 60,
  frontOverlap: 0.8,
  sideOverlap: 0.7,
  angleDeg: 0,
  speedMs: 8,
  gimbalPitchDeg: -90,
  crosshatch: false,
  overshootM: 10,
  triggerMode: 'interval',
  startNear: null,
}

type Line = [LngLat, LngLat]

/**
 * Boustrophedon ("lawnmower") flight lines covering a polygon.
 *
 * Works in a local metric frame rotated so flight lines are horizontal, then sweeps
 * horizontal scanlines across it. Each scanline spans the outermost polygon crossings,
 * so concave shapes are flown straight across their gaps – slightly wasteful, but it
 * never leaves holes in coverage.
 */
export function sweepLines(ring: LngLat[], lineSpacingM: number, angleDeg: number, overshootM: number): Line[] {
  const frame = localFrame(centroid(ring))
  // Rotate so the flight bearing maps onto the +x axis.
  const theta = ((angleDeg - 90) * Math.PI) / 180
  const pts = ring.map((p) => rotate(frame.toXY(p), theta))

  const ys = pts.map((p) => p[1])
  const minY = Math.min(...ys)
  const height = Math.max(...ys) - minY
  const n = Math.max(1, Math.ceil(height / lineSpacingM))
  const step = height / n // ≤ requested spacing, evenly distributed

  const lines: Line[] = []
  for (let i = 0; i < n; i++) {
    const y = minY + step * (i + 0.5)
    const xs: number[] = []
    for (let j = 0; j < pts.length; j++) {
      const [x1, y1] = pts[j]
      const [x2, y2] = pts[(j + 1) % pts.length]
      if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
      }
    }
    if (xs.length < 2) continue
    let a: [number, number] = [Math.min(...xs) - overshootM, y]
    let b: [number, number] = [Math.max(...xs) + overshootM, y]
    if (lines.length % 2 === 1) [a, b] = [b, a] // alternate direction
    lines.push([frame.toLngLat(rotate(a, -theta)), frame.toLngLat(rotate(b, -theta))])
  }
  return lines
}

/**
 * A lawnmower pattern can be flown four ways: either end line first, entering from either
 * side. Pick the variant whose first point is nearest `near`.
 */
export function orientLines(lines: Line[], near: LngLat | null): Line[] {
  if (!near || lines.length === 0) return lines
  const flip = (ls: Line[]) => ls.map(([a, b]) => [b, a] as Line)
  const candidates = [lines, [...lines].reverse(), flip(lines), flip([...lines].reverse())]
  let best = candidates[0]
  for (const c of candidates) if (distanceM(c[0][0], near) < distanceM(best[0][0], near)) best = c
  return best
}

function pointsAlong([a, b]: Line, spacingM: number): LngLat[] {
  const len = distanceM(a, b)
  const count = Math.max(1, Math.floor(len / spacingM)) + 1
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1)
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as LngLat
  })
}

export function planGrid(ring: LngLat[], drone: DroneProfile, p: GridParams, name = 'Grid mission'): Mission {
  const { lineSpacingM, photoSpacingM } = gridSpacing(drone.camera, p.altitudeM, p.frontOverlap, p.sideOverlap)

  const first = orientLines(sweepLines(ring, lineSpacingM, p.angleDeg, p.overshootM), p.startNear)
  const lines = [...first]
  if (p.crosshatch && first.length) {
    // Second pass starts wherever the first one finished, so there's no long transit.
    lines.push(...orientLines(sweepLines(ring, lineSpacingM, p.angleDeg + 90, p.overshootM), first.at(-1)![1]))
  }

  const mission: Mission = { name, droneId: drone.id, waypoints: [], intervalSegments: [], photoPoints: [] }
  const wp = (position: LngLat, actions: Waypoint['actions'] = []): Waypoint => ({
    position,
    altitudeM: p.altitudeM,
    speedMs: p.speedMs,
    gimbalPitchDeg: p.gimbalPitchDeg,
    actions,
  })

  for (const line of lines) {
    const photos = pointsAlong(line, photoSpacingM)
    mission.photoPoints.push(...photos)
    if (p.triggerMode === 'interval') {
      const startIndex = mission.waypoints.length
      mission.waypoints.push(wp(line[0]), wp(line[1]))
      mission.intervalSegments.push({ startIndex, endIndex: startIndex + 1, distanceM: photoSpacingM })
    } else {
      for (const pos of photos) mission.waypoints.push(wp(pos, [{ type: 'takePhoto' }]))
    }
  }

  if (mission.waypoints.length > 0) {
    mission.waypoints[0].actions.unshift({ type: 'gimbalPitch', pitchDeg: p.gimbalPitchDeg })
  }
  return mission
}
