import { localFrame } from '../geo'
import type { DroneProfile, LngLat, Mission } from '../types'

export interface OrbitRing {
  altitudeM: number
  gimbalPitchDeg: number
}

export interface OrbitParams {
  radiusM: number
  rings: OrbitRing[]
  photosPerRing: number
  speedMs: number
  clockwise: boolean
}

/**
 * Rings stacked from just above the subject's base to above its top, each aimed at the
 * subject's vertical midpoint. Many viewing angles at varying elevation is what Gaussian
 * splatting and object-scale photogrammetry need – nadir grids alone produce "melted" sides.
 */
export function autoRings(subjectHeightM: number, radiusM: number, count: number): OrbitRing[] {
  const aimAt = subjectHeightM / 2
  const low = Math.max(5, subjectHeightM * 0.3)
  const high = subjectHeightM + radiusM * 0.6
  return Array.from({ length: count }, (_, i) => {
    const altitudeM = count === 1 ? (low + high) / 2 : low + ((high - low) * i) / (count - 1)
    const pitch = -(Math.atan2(altitudeM - aimAt, radiusM) * 180) / Math.PI
    return { altitudeM: Math.round(altitudeM), gimbalPitchDeg: Math.round(Math.max(-90, Math.min(0, pitch))) }
  })
}

export const defaultOrbitParams: OrbitParams = {
  radiusM: 30,
  rings: autoRings(15, 30, 3),
  photosPerRing: 36,
  speedMs: 3,
  clockwise: true,
}

export function planOrbit(center: LngLat, drone: DroneProfile, p: OrbitParams, name = 'Orbit mission'): Mission {
  const frame = localFrame(center)
  const mission: Mission = { name, droneId: drone.id, waypoints: [], intervalSegments: [], photoPoints: [] }
  const dir = p.clockwise ? -1 : 1

  for (const ring of p.rings) {
    for (let i = 0; i < p.photosPerRing; i++) {
      // Start due south of the subject, so every ring begins at the same bearing.
      const a = -Math.PI / 2 + (dir * 2 * Math.PI * i) / p.photosPerRing
      const position = frame.toLngLat([Math.cos(a) * p.radiusM, Math.sin(a) * p.radiusM])
      mission.photoPoints.push(position)
      mission.waypoints.push({
        position,
        altitudeM: ring.altitudeM,
        speedMs: p.speedMs,
        poi: center,
        gimbalPitchDeg: ring.gimbalPitchDeg,
        actions: [
          ...(i === 0 ? [{ type: 'gimbalPitch' as const, pitchDeg: ring.gimbalPitchDeg }] : []),
          { type: 'takePhoto' as const },
        ],
      })
    }
  }
  return mission
}
