import { localFrame } from '../geo'
import type { DroneProfile, LngLat, Mission } from '../types'

export interface OrbitRing {
  altitudeM: number
  /** Horizontal distance from the subject. Missing on plans saved before per-ring distances. */
  radiusM?: number
  gimbalPitchDeg: number
}

/** Camera pitch that centres the subject's mid-height in frame. */
export function aimPitch(altitudeM: number, radiusM: number, subjectHeightM: number): number {
  const pitch = -(Math.atan2(altitudeM - subjectHeightM / 2, radiusM) * 180) / Math.PI
  return Math.round(Math.max(-90, Math.min(0, pitch)))
}

export const ringRadius = (ring: OrbitRing, p: Pick<OrbitParams, 'radiusM'>) => ring.radiusM ?? p.radiusM

export interface OrbitParams {
  radiusM: number
  rings: OrbitRing[]
  photosPerRing: number
  speedMs: number
  clockwise: boolean
  /** Where on the ring the first photo is taken, degrees clockwise from north. */
  startBearingDeg: number
}

/**
 * Rings stacked from just above the subject's base to above its top, each aimed at the
 * subject's vertical midpoint. Many viewing angles at varying elevation is what Gaussian
 * splatting and object-scale photogrammetry need – nadir grids alone produce "melted" sides.
 */
export function autoRings(subjectHeightM: number, radiusM: number, count: number): OrbitRing[] {
  const low = Math.max(5, subjectHeightM * 0.3)
  const high = subjectHeightM + radiusM * 0.6
  return Array.from({ length: count }, (_, i) => {
    const altitudeM = count === 1 ? (low + high) / 2 : low + ((high - low) * i) / (count - 1)
    const alt = Math.round(altitudeM)
    return { altitudeM: alt, radiusM, gimbalPitchDeg: aimPitch(alt, radiusM, subjectHeightM) }
  })
}

export const defaultOrbitParams: OrbitParams = {
  radiusM: 30,
  rings: autoRings(15, 30, 3),
  photosPerRing: 36,
  speedMs: 3,
  clockwise: true,
  startBearingDeg: 180,
}

export function planOrbit(center: LngLat, drone: DroneProfile, p: OrbitParams, name = 'Orbit mission'): Mission {
  const frame = localFrame(center)
  const mission: Mission = { name, droneId: drone.id, waypoints: [], intervalSegments: [], photoPoints: [] }
  const dir = p.clockwise ? -1 : 1

  for (const ring of p.rings) {
    const radius = ringRadius(ring, p)
    for (let i = 0; i < p.photosPerRing; i++) {
      // Every ring begins at the same bearing. Bearing → maths angle (x east, y north).
      const a = ((90 - (p.startBearingDeg ?? 180)) * Math.PI) / 180 + (dir * 2 * Math.PI * i) / p.photosPerRing
      const position = frame.toLngLat([Math.cos(a) * radius, Math.sin(a) * radius])
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
