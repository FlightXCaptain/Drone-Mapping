import { distanceM } from './geo'
import { gsdCm } from './photogrammetry'
import type { DroneProfile, Mission, MissionStats } from './types'

const CLIMB_RATE_MS = 4 // conservative average for DJI ascent/descent
const STOP_PER_PHOTO_WAYPOINT_S = 2 // decelerate, stabilise, shoot, accelerate
const TURN_S = 4 // per change of line/segment direction

/** Every flight lands with at least this much battery left. */
export const BATTERY_RESERVE = 0.2

/**
 * How many batteries the mission needs, planning to land each one at 20%.
 * `drone.flightTimeMin` is the manufacturer's rated (still-air, fresh battery) figure.
 */
export function estimateBatteries(flightSeconds: number, drone: DroneProfile): number {
  const usableSeconds = drone.flightTimeMin * 60 * (1 - BATTERY_RESERVE)
  return Math.max(1, Math.ceil(flightSeconds / usableSeconds))
}

/**
 * `cameraDistanceM` overrides the camera-to-surface distance used for GSD. Grids look straight
 * down so altitude is right, but an orbit looks sideways at its subject from the slant range.
 */
export function missionStats(
  mission: Mission,
  drone: DroneProfile,
  areaM2: number | null = null,
  cameraDistanceM?: number,
): MissionStats {
  const wps = mission.waypoints
  let distance = 0
  let duration = 0
  for (let i = 1; i < wps.length; i++) {
    const d = distanceM(wps[i - 1].position, wps[i].position)
    distance += d
    duration += d / wps[i].speedMs
    duration += Math.abs(wps[i].altitudeM - wps[i - 1].altitudeM) / CLIMB_RATE_MS
  }
  const photoStops = wps.filter((w) => w.actions.some((a) => a.type === 'takePhoto')).length
  duration += photoStops * STOP_PER_PHOTO_WAYPOINT_S
  duration += mission.intervalSegments.length * TURN_S
  // Climb to first waypoint and descend from the last.
  if (wps.length) duration += (wps[0].altitudeM + wps.at(-1)!.altitudeM) / CLIMB_RATE_MS

  const warnings: string[] = []
  if (wps.length > drone.maxWaypoints) {
    warnings.push(
      `${wps.length} waypoints exceeds the ${drone.maxWaypoints} supported by ${drone.name}. Split the area or use interval shooting.`,
    )
  }
  for (const seg of mission.intervalSegments) {
    const speed = wps[seg.startIndex + 1]?.speedMs ?? 0
    if (speed * drone.minPhotoIntervalS > seg.distanceM) {
      warnings.push(
        `Speed is too high for the camera: one photo every ${seg.distanceM.toFixed(1)} m needs ≤ ${(seg.distanceM / drone.minPhotoIntervalS).toFixed(1)} m/s.`,
      )
      break
    }
  }
  if (mission.intervalSegments.length && drone.exportTargets.includes('djifly')) {
    warnings.push('DJI Fly may ignore distance-interval shooting. Switch Photo trigger to "Waypoint per photo" for a reliable capture.')
  }
  const batteries = wps.length ? estimateBatteries(duration, drone) : 0
  if (batteries > 4) {
    warnings.push(
      `This flight needs ${batteries} batteries. Check the area is drawn around the site you mean, or split it into smaller flights.`,
    )
  }
  const maxAlt = Math.max(0, ...wps.map((w) => w.altitudeM))
  if (maxAlt > 120) warnings.push(`Max altitude ${maxAlt} m exceeds the common 120 m (400 ft) regulatory ceiling.`)

  return {
    distanceM: distance,
    durationS: duration,
    photoCount: mission.photoPoints.length,
    waypointCount: wps.length,
    batteries,
    gsdCm: wps.length ? gsdCm(drone.camera, cameraDistanceM ?? wps[0].altitudeM) : null,
    areaM2,
    warnings,
  }
}
