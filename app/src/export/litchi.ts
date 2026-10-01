import { bearingDeg } from '../domain/geo'
import type { Mission } from '../domain/types'

/**
 * Litchi Mission Hub CSV. Litchi flies DJI aircraft that have no native waypoint support
 * in DJI Fly (Mini 2/SE, Air 2S, Mavic 2…). Altitudes are relative to take-off.
 */
const ACTION_SLOTS = 15
const ACTION = { none: -1, stay: 0, photo: 1, tilt: 5 } as const

const HEADER = [
  'latitude',
  'longitude',
  'altitude(m)',
  'heading(deg)',
  'curvesize(m)',
  'rotationdir',
  'gimbalmode',
  'gimbalpitchangle',
  ...Array.from({ length: ACTION_SLOTS }, (_, i) => [`actiontype${i + 1}`, `actionparam${i + 1}`]).flat(),
  'altitudemode',
  'speed(m/s)',
  'poi_latitude',
  'poi_longitude',
  'poi_altitude(m)',
  'poi_altitudemode',
  'photo_timeinterval',
  'photo_distinterval',
]

export function buildLitchiCsv(mission: Mission): string {
  const wps = mission.waypoints
  const rows = wps.map((w, i) => {
    const next = wps[i + 1] ?? wps[i - 1]
    const heading = w.poi
      ? bearingDeg(w.position, w.poi)
      : w.headingDeg ?? (next && next !== w ? bearingDeg(w.position, next.position) : 0)

    const actions: [number, number][] = w.actions.map((a) =>
      a.type === 'takePhoto' ? [ACTION.photo, 0] : a.type === 'gimbalPitch' ? [ACTION.tilt, a.pitchDeg] : [ACTION.stay, a.seconds * 1000],
    )
    while (actions.length < ACTION_SLOTS) actions.push([ACTION.none, 0])

    const seg = mission.intervalSegments.find((s) => i >= s.startIndex && i < s.endIndex)
    return [
      w.position[1].toFixed(7),
      w.position[0].toFixed(7),
      w.altitudeM.toFixed(1),
      heading.toFixed(1),
      0.2, // curve size: near-zero = straight lines through each point
      0, // rotation direction: shortest
      2, // gimbal mode: interpolate between waypoint pitches
      w.gimbalPitchDeg,
      ...actions.slice(0, ACTION_SLOTS).flat(),
      0, // altitude mode: relative to take-off
      w.speedMs.toFixed(1),
      w.poi ? w.poi[1].toFixed(7) : 0,
      w.poi ? w.poi[0].toFixed(7) : 0,
      0,
      0,
      -1, // photo time interval: off
      seg ? seg.distanceM.toFixed(2) : -1,
    ].join(',')
  })
  return [HEADER.join(','), ...rows].join('\n') + '\n'
}
