import type { Mission, Waypoint } from './types'

/**
 * Join several planned parts into one flyable mission.
 *
 * Between parts the aircraft climbs to the higher of the two parts' heights, crosses at that
 * height, then drops into the next part. It never descends across ground it hasn't been
 * planned over. Transit legs take no photos.
 */
export function combineMissions(parts: Mission[], name: string, droneId: string): Mission {
  const out: Mission = { name, droneId, waypoints: [], intervalSegments: [], photoPoints: [] }
  const transitSpeed = (w: Waypoint) => Math.max(w.speedMs, 8)

  for (const part of parts.filter((m) => m.waypoints.length > 0)) {
    const prev = out.waypoints.at(-1)
    const next = part.waypoints[0]
    if (prev) {
      const transitAlt = Math.max(prev.altitudeM, next.altitudeM)
      const hop = (w: Waypoint): Waypoint => ({
        position: w.position,
        altitudeM: transitAlt,
        speedMs: transitSpeed(next),
        gimbalPitchDeg: w.gimbalPitchDeg,
        actions: [],
      })
      if (prev.altitudeM < transitAlt) out.waypoints.push(hop(prev)) // climb in place
      if (next.altitudeM < transitAlt) out.waypoints.push(hop(next)) // cross, then descend into the part
    }
    const offset = out.waypoints.length
    out.waypoints.push(...part.waypoints)
    out.intervalSegments.push(
      ...part.intervalSegments.map((s) => ({ ...s, startIndex: s.startIndex + offset, endIndex: s.endIndex + offset })),
    )
    out.photoPoints.push(...part.photoPoints)
  }
  return out
}
