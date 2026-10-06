import { distanceM } from './geo'
import type { LngLat } from './types'

export interface Coverage {
  /** Planned shots with a real photo within the tolerance. */
  found: number
  /** Planned shots nobody took, to mark on the map. */
  missing: LngLat[]
  /** Photos not near any planned shot (e.g. a manual flight, or a different site). */
  unplanned: number
}

/**
 * Match the photos from a flight to the planned shots. Consumer drone GPS wanders a few metres,
 * so a planned shot counts as taken when a photo lies within `toleranceM` of it.
 */
export function coverage(planned: LngLat[], taken: LngLat[], toleranceM = 10): Coverage {
  const near = (p: LngLat) => taken.some((t) => Math.abs(t[1] - p[1]) < 0.001 && distanceM(t, p) <= toleranceM)
  const missing = planned.filter((p) => !near(p))
  const unplanned = taken.filter((t) => !planned.some((p) => Math.abs(t[1] - p[1]) < 0.001 && distanceM(t, p) <= toleranceM)).length
  return { found: planned.length - missing.length, missing, unplanned }
}
