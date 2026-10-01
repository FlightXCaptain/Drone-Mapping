import JSZip from 'jszip'
import { distanceM } from '../domain/geo'
import type { LngLat, Mission } from '../domain/types'

/**
 * Read back a DJI WPML KMZ, i.e. exactly what the aircraft will execute (waylines.wpml).
 * Used to check a mission on the controller, or any .kmz, independently of DJI Fly's display.
 */
export interface ReadWaypoint {
  index: number
  position: LngLat
  heightM: number
  speedMs: number | null
  headingDeg: number | null
  gimbalPitchDeg: number | null
  photo: boolean
}

export interface ReadMission {
  waypoints: ReadWaypoint[]
  heightMode: string | null
  droneEnumValue: number | null
  author: string | null
  finishAction: string | null
  rcLostAction: string | null
}

const WPML_NS = ['http://www.uav.com/wpmz/1.0.2', 'http://www.dji.com/wpmz/1.0.6', 'http://www.dji.com/wpmz/1.0.2']

function wpml(el: Element | Document, name: string): Element | null {
  for (const ns of WPML_NS) {
    const found = el.getElementsByTagNameNS(ns, name)[0]
    if (found) return found
  }
  return null
}
const num = (el: Element | null) => (el?.textContent != null && el.textContent.trim() !== '' ? Number(el.textContent) : null)
const txt = (el: Element | null) => el?.textContent?.trim() ?? null

/** Direct wpml children only, so nested action params aren't mistaken for waypoint fields. */
function child(el: Element, name: string): Element | null {
  for (const c of Array.from(el.children)) if (c.localName === name) return c
  return null
}

export function parseWaylines(xml: string): ReadMission {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The mission file is not valid XML.')
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'))
  if (placemarks.length === 0) throw new Error('The mission file has no waypoints.')

  const waypoints = placemarks.map((pm, i): ReadWaypoint => {
    const coords = pm.getElementsByTagName('coordinates')[0]?.textContent?.trim().split(',').map(Number) ?? []
    if (coords.length < 2 || coords.some((c) => !Number.isFinite(c))) throw new Error(`Waypoint ${i + 1} has no valid coordinates.`)

    const funcs = Array.from(pm.getElementsByTagName('*')).filter((e) => e.localName === 'actionActuatorFunc')
    const photo = funcs.some((f) => f.textContent === 'takePhoto')
    // Gimbal pitch: DJI Fly's per-waypoint block first, else the first gimbal action at this waypoint.
    const gh = child(pm, 'waypointGimbalHeadingParam')
    let pitch = gh ? num(Array.from(gh.children).find((c) => c.localName === 'waypointGimbalPitchAngle') ?? null) : null
    if (pitch === null) {
      const rot = Array.from(pm.getElementsByTagName('*')).find((e) => e.localName === 'gimbalPitchRotateAngle')
      pitch = rot ? num(rot) : null
    }
    const hp = child(pm, 'waypointHeadingParam')
    const headingEnabled = hp && num(Array.from(hp.children).find((c) => c.localName === 'waypointHeadingAngleEnable') ?? null) === 1
    const heading = hp && headingEnabled ? num(Array.from(hp.children).find((c) => c.localName === 'waypointHeadingAngle') ?? null) : null

    return {
      index: num(child(pm, 'index')) ?? i,
      position: [coords[0], coords[1]],
      heightM: num(child(pm, 'executeHeight')) ?? num(child(pm, 'height')) ?? NaN,
      speedMs: num(child(pm, 'waypointSpeed')),
      headingDeg: heading,
      gimbalPitchDeg: pitch,
      photo,
    }
  })

  return {
    waypoints,
    heightMode: txt(wpml(doc, 'executeHeightMode')),
    droneEnumValue: num(wpml(doc, 'droneEnumValue')),
    author: txt(wpml(doc, 'author')),
    finishAction: txt(wpml(doc, 'finishAction')),
    rcLostAction: txt(wpml(doc, 'executeRCLostAction')),
  }
}

export async function readKmz(data: Blob | ArrayBuffer): Promise<ReadMission> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data instanceof Blob ? await data.arrayBuffer() : data)
  } catch {
    throw new Error("That file isn't a KMZ mission.")
  }
  const waylines = zip.file('wpmz/waylines.wpml')
  if (!waylines) throw new Error('No wpmz/waylines.wpml inside, so this is not a DJI waypoint mission.')
  const read = parseWaylines(await waylines.async('string'))
  // DJI Fly keeps author in template.kml.
  if (!read.author) {
    const t = await zip.file('wpmz/template.kml')?.async('string')
    read.author = t?.match(/<wpml:author>([^<]*)</)?.[1] ?? null
  }
  return read
}

export interface Comparison {
  matches: boolean
  /** One plain-language line per difference, capped. */
  differences: string[]
}

/** Compare what's on the controller with the planned mission: positions to 0.5 m, heights to 0.1 m. */
export function compareWithPlan(read: ReadMission, plan: Mission): Comparison {
  const diffs: string[] = []
  if (read.waypoints.length !== plan.waypoints.length) {
    diffs.push(`${read.waypoints.length} waypoints on the controller, ${plan.waypoints.length} in your plan.`)
    // Clearly a different mission: one line, not a waypoint-by-waypoint list.
    const off = read.waypoints[0] && plan.waypoints[0] ? distanceM(read.waypoints[0].position, plan.waypoints[0].position) : 0
    if (off > 0.5) diffs.push(`It starts ${off >= 1000 ? `${(off / 1000).toFixed(1)} km` : `${off.toFixed(0)} m`} from where your plan starts.`)
    return { matches: false, differences: diffs }
  }
  const n = Math.min(read.waypoints.length, plan.waypoints.length)
  for (let i = 0; i < n && diffs.length < 8; i++) {
    const r = read.waypoints[i]
    const p = plan.waypoints[i]
    const off = distanceM(r.position, p.position)
    if (off > 0.5) diffs.push(`Waypoint ${i + 1} is ${off.toFixed(1)} m from where the plan has it.`)
    if (Math.abs(r.heightM - p.altitudeM) > 0.1) diffs.push(`Waypoint ${i + 1} height is ${r.heightM} m; the plan says ${p.altitudeM} m.`)
    const planPhoto = p.actions.some((a) => a.type === 'takePhoto') || plan.intervalSegments.some((s) => s.startIndex === i)
    if (r.photo !== planPhoto) diffs.push(`Waypoint ${i + 1} ${r.photo ? 'takes' : "doesn't take"} a photo; the plan ${planPhoto ? 'does' : "doesn't"}.`)
  }
  return { matches: diffs.length === 0, differences: diffs }
}
