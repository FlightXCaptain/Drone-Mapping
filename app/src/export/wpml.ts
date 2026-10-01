import JSZip from 'jszip'
import { bearingDeg } from '../domain/geo'
import { missionStats } from '../domain/stats'
import type { DroneProfile, Mission, Waypoint } from '../domain/types'

/**
 * DJI WPML (Waypoint Markup Language) KMZ export.
 *
 * Layout:  wpmz/template.kml   – editable mission intent (what Pilot 2 shows in its editor)
 *          wpmz/waylines.wpml  – executable route the aircraft actually flies
 *
 * Heights are relative to the take-off point. Orbits get an explicit heading at each
 * waypoint instead of WPML's POI mode, because every DJI app honours fixed headings.
 */

export type WpmlTarget = 'pilot2' | 'djifly'

/**
 * DJI Fly reads a narrower, older dialect than Pilot 2 (community-verified against files
 * DJI Fly itself writes): different namespace host, no payloadInfo, 1-based action IDs,
 * and an uncompressed zip.
 */
interface Dialect {
  ns: string
  author: string
  payloadInfo: boolean
  takeOffSecurityHeight: boolean
  firstActionId: number
  compression: 'DEFLATE' | 'STORE'
  /** DJI Fly only executes waylines.wpml; its own template.kml is a stub with no route. */
  templateStub: boolean
}

const DIALECTS: Record<WpmlTarget, Dialect> = {
  pilot2: {
    ns: 'http://www.dji.com/wpmz/1.0.6',
    author: 'Drone Mapping',
    payloadInfo: true,
    takeOffSecurityHeight: true,
    firstActionId: 0,
    compression: 'DEFLATE',
    templateStub: false,
  },
  djifly: {
    ns: 'http://www.uav.com/wpmz/1.0.2',
    author: 'fly',
    payloadInfo: false,
    takeOffSecurityHeight: false,
    firstActionId: 1,
    compression: 'STORE',
    templateStub: true,
  },
}

const f =(n: number, dp = 6) => Number(n.toFixed(dp)).toString()
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** DJI headings are −180..180, 0 = north. */
function headingFor(w: Waypoint): number | undefined {
  if (w.poi) {
    const b = bearingDeg(w.position, w.poi)
    return b > 180 ? b - 360 : b
  }
  if (w.headingDeg === undefined) return undefined
  return w.headingDeg > 180 ? w.headingDeg - 360 : w.headingDeg
}

function missionConfig(drone: DroneProfile, mission: Mission, d: Dialect): string {
  if (!drone.wpml) throw new Error(`${drone.name} has no WPML aircraft IDs. Edit the aircraft and add them.`)
  const ids = drone.wpml
  const firstSpeed = mission.waypoints[0]?.speedMs ?? 5
  const payload = d.payloadInfo
    ? `
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>${ids.payloadEnumValue}</wpml:payloadEnumValue>
        <wpml:payloadSubEnumValue>${ids.payloadSubEnumValue}</wpml:payloadSubEnumValue>
        <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
      </wpml:payloadInfo>`
    : ''
  return `
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>${d.takeOffSecurityHeight ? `
      <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>` : ''}
      <wpml:globalTransitionalSpeed>${f(Math.min(drone.maxSpeedMs, Math.max(firstSpeed, 8)), 1)}</wpml:globalTransitionalSpeed>
      <wpml:globalRTHHeight>${Math.max(30, ...mission.waypoints.map((w) => Math.ceil(w.altitudeM)))}</wpml:globalRTHHeight>
      <wpml:droneInfo>
        <wpml:droneEnumValue>${ids.droneEnumValue}</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>${ids.droneSubEnumValue}</wpml:droneSubEnumValue>
      </wpml:droneInfo>${payload}
    </wpml:missionConfig>`
}

function headingParam(w: Waypoint): string {
  const h = headingFor(w)
  return `
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>${h === undefined ? 'followWayline' : 'smoothTransition'}</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${h === undefined ? 0 : f(h, 1)}</wpml:waypointHeadingAngle>
          <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
          <wpml:waypointHeadingAngleEnable>${h === undefined ? 0 : 1}</wpml:waypointHeadingAngleEnable>
          <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
        </wpml:waypointHeadingParam>`
}

// Stop at every waypoint: photo waypoints need a still aircraft for sharp images, and on
// mapping grids the waypoints are the line-end turn-arounds, where curving would cut the overshoot.
function turnParam(): string {
  return `
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>`
}

function gimbalAction(id: number, pitch: number): string {
  return `
          <wpml:action>
            <wpml:actionId>${id}</wpml:actionId>
            <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:gimbalHeadingYawBase>north</wpml:gimbalHeadingYawBase>
              <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>
              <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
              <wpml:gimbalPitchRotateAngle>${f(pitch, 1)}</wpml:gimbalPitchRotateAngle>
              <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>
              <wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>
              <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>
              <wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>
              <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>
              <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>
              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            </wpml:actionActuatorFuncParam>
          </wpml:action>`
}

function photoAction(id: number): string {
  return `
          <wpml:action>
            <wpml:actionId>${id}</wpml:actionId>
            <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
              <wpml:useGlobalPayloadLensIndex>0</wpml:useGlobalPayloadLensIndex>
            </wpml:actionActuatorFuncParam>
          </wpml:action>`
}

function hoverAction(id: number, seconds: number): string {
  return `
          <wpml:action>
            <wpml:actionId>${id}</wpml:actionId>
            <wpml:actionActuatorFunc>hover</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:hoverTime>${f(seconds, 1)}</wpml:hoverTime>
            </wpml:actionActuatorFuncParam>
          </wpml:action>`
}

/** Action groups for one waypoint: its own reachPoint actions, plus any interval segment starting here. */
function actionGroups(mission: Mission, index: number, nextGroupId: () => number, d: Dialect): string {
  const w = mission.waypoints[index]
  let out = ''
  // DJI Fly expects an explicit gimbal pitch on every waypoint (it writes one itself);
  // relying on a pitch inherited from an earlier waypoint is unreliable there.
  const own =
    d.firstActionId === 1 && !w.actions.some((a) => a.type === 'gimbalPitch')
      ? [{ type: 'gimbalPitch' as const, pitchDeg: w.gimbalPitchDeg }, ...w.actions]
      : w.actions
  if (own.length) {
    let aid = d.firstActionId
    const actions = own
      .map((a) =>
        a.type === 'takePhoto' ? photoAction(aid++) : a.type === 'gimbalPitch' ? gimbalAction(aid++, a.pitchDeg) : hoverAction(aid++, a.seconds),
      )
      .join('')
    out += `
        <wpml:actionGroup>
          <wpml:actionGroupId>${nextGroupId()}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${index}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${index}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>${actions}
        </wpml:actionGroup>`
  }
  for (const seg of mission.intervalSegments.filter((s) => s.startIndex === index)) {
    out += `
        <wpml:actionGroup>
          <wpml:actionGroupId>${nextGroupId()}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${seg.startIndex}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${seg.endIndex}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType>
            <wpml:actionTriggerParam>${f(seg.distanceM, 2)}</wpml:actionTriggerParam>
          </wpml:actionTrigger>${photoAction(d.firstActionId)}
        </wpml:actionGroup>`
  }
  return out
}

function placemarks(mission: Mission, kind: 'template' | 'waylines', d: Dialect): string {
  let groupId = 0
  const nextGroupId = () => groupId++
  return mission.waypoints
    .map((w, i) => {
      const height =
        kind === 'template'
          ? `
        <wpml:ellipsoidHeight>${f(w.altitudeM, 2)}</wpml:ellipsoidHeight>
        <wpml:height>${f(w.altitudeM, 2)}</wpml:height>
        <wpml:useGlobalHeight>0</wpml:useGlobalHeight>
        <wpml:useGlobalSpeed>0</wpml:useGlobalSpeed>
        <wpml:useGlobalHeadingParam>0</wpml:useGlobalHeadingParam>
        <wpml:useGlobalTurnParam>0</wpml:useGlobalTurnParam>
        <wpml:gimbalPitchAngle>${f(w.gimbalPitchDeg, 1)}</wpml:gimbalPitchAngle>`
          : `
        <wpml:executeHeight>${f(w.altitudeM, 2)}</wpml:executeHeight>`
      return `
      <Placemark>
        <Point><coordinates>${f(w.position[0])},${f(w.position[1])}</coordinates></Point>
        <wpml:index>${i}</wpml:index>${height}
        <wpml:waypointSpeed>${f(w.speedMs, 1)}</wpml:waypointSpeed>${headingParam(w)}${turnParam()}
        <wpml:useStraightLine>1</wpml:useStraightLine>${actionGroups(mission, i, nextGroupId, d)}
      </Placemark>`
    })
    .join('')
}


export function buildTemplateKml(mission: Mission, drone: DroneProfile, target: WpmlTarget, now = Date.now()): string {
  const d = DIALECTS[target]
  const speed = mission.waypoints[0]?.speedMs ?? 5
  if (d.templateStub) {
    // Mirrors the template.kml DJI Fly writes itself (verified against a file from an RC 2).
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${d.ns}">
  <Document>
    <wpml:author>${esc(d.author)}</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>${missionConfig(drone, mission, d)}
  </Document>
</kml>
`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${d.ns}">
  <Document>
    <wpml:author>${esc(d.author)}</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>${missionConfig(drone, mission, d)}
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineCoordinateSysParam>
        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
        <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
      </wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${f(speed, 1)}</wpml:autoFlightSpeed>
      <wpml:globalHeight>${f(mission.waypoints[0]?.altitudeM ?? 50, 1)}</wpml:globalHeight>
      <wpml:caliFlightEnable>0</wpml:caliFlightEnable>
      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
      <wpml:globalWaypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
        <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
        <wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>
      </wpml:globalWaypointHeadingParam>
      <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>${placemarks(mission, 'template', d)}
    </Folder>
  </Document>
</kml>
`
}

export function buildWaylinesWpml(mission: Mission, drone: DroneProfile, target: WpmlTarget): string {
  const d = DIALECTS[target]
  const speed = mission.waypoints[0]?.speedMs ?? 5
  // Same estimate the app shows (includes photo stops and climbs), so both agree.
  const { distanceM: distance, durationS: duration } = missionStats(mission, drone)
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${d.ns}">
  <Document>${missionConfig(drone, mission, d)}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:distance>${f(distance, 1)}</wpml:distance>
      <wpml:duration>${f(duration, 1)}</wpml:duration>
      <wpml:autoFlightSpeed>${f(speed, 1)}</wpml:autoFlightSpeed>${placemarks(mission, 'waylines', d)}
    </Folder>
  </Document>
</kml>
`
}

export async function buildKmz(mission: Mission, drone: DroneProfile, target: WpmlTarget): Promise<Blob> {
  if (mission.waypoints.length < 2) throw new Error('A mission needs at least 2 waypoints.')
  if (mission.waypoints.length > drone.maxWaypoints) {
    throw new Error(`${mission.waypoints.length} waypoints exceeds the ${drone.maxWaypoints} limit for ${drone.name}.`)
  }
  // Exactly two entries, like DJI's own files: no directory entries, no empty res/ folder.
  const zip = new JSZip()
  zip.file('wpmz/template.kml', buildTemplateKml(mission, drone, target), { createFolders: false })
  zip.file('wpmz/waylines.wpml', buildWaylinesWpml(mission, drone, target), { createFolders: false })
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.google-earth.kmz',
    compression: DIALECTS[target].compression,
  })
}
