// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildKmz, buildTemplateKml, buildWaylinesWpml } from './wpml'
import { buildLitchiCsv } from './litchi'
import { BUILTIN_DRONES } from '../domain/drones'
import { planGrid, defaultGridParams } from '../domain/planners/grid'
import { planOrbit, defaultOrbitParams } from '../domain/planners/orbit'
import type { LngLat } from '../domain/types'

const m3e = BUILTIN_DRONES.find((d) => d.id === 'dji-m3e')!
const mini4 = BUILTIN_DRONES.find((d) => d.id === 'dji-mini-4-pro')!
const RECT: LngLat[] = [
  [115.85, -31.95],
  [115.851, -31.95],
  [115.851, -31.9505],
  [115.85, -31.9505],
  [115.85, -31.95],
]
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')

describe('WPML export', () => {
  const grid = planGrid(RECT, m3e, defaultGridParams)

  it('produces well-formed XML with one Placemark per waypoint', () => {
    for (const xml of [buildTemplateKml(grid, m3e, 'pilot2'), buildWaylinesWpml(grid, m3e, 'pilot2')]) {
      const doc = parse(xml)
      expect(doc.getElementsByTagName('parsererror').length).toBe(0)
      expect(doc.getElementsByTagName('Placemark').length).toBe(grid.waypoints.length)
    }
  })

  it('Pilot 2 dialect: dji.com namespace, payloadInfo and multipleDistance triggers', () => {
    const xml = buildWaylinesWpml(grid, m3e, 'pilot2')
    expect(xml).toContain('http://www.dji.com/wpmz/1.0.6')
    expect(xml).toContain('<wpml:payloadEnumValue>66</wpml:payloadEnumValue>')
    expect(xml.match(/multipleDistance/g)?.length).toBe(grid.intervalSegments.length)
  })

  it('DJI Fly dialect: uav.com namespace, no payloadInfo, 1-based actions, pitch on every waypoint', () => {
    const m = planGrid(RECT, mini4, { ...defaultGridParams, triggerMode: 'waypoint' })
    const xml = buildWaylinesWpml(m, mini4, 'djifly')
    expect(xml).toContain('http://www.uav.com/wpmz/1.0.2')
    expect(xml).not.toContain('payloadInfo')
    expect(xml).not.toMatch(/<wpml:actionId>0<\/wpml:actionId>/)
    expect(xml.match(/gimbalRotate</g)?.length).toBe(m.waypoints.length)
  })

  it('DJI Fly waylines mirror what DJI Fly writes itself', () => {
    const m = planGrid(RECT, mini4, { ...defaultGridParams, triggerMode: 'waypoint' })
    const xml = buildWaylinesWpml(m, mini4, 'djifly')
    expect(xml).not.toContain('Discontinuity')
    expect(xml).toContain('toPointAndStopWithContinuityCurvature')
    expect(xml.match(/<wpml:waypointGimbalHeadingParam>/g)?.length).toBe(m.waypoints.length)
    expect(xml.match(/<wpml:waypointHeadingPoiIndex>/g)?.length).toBe(m.waypoints.length)
    expect(xml).not.toContain('globalRTHHeight')
    expect(xml).toContain('<wpml:gimbalHeadingYawBase>aircraft</wpml:gimbalHeadingYawBase>')
    const ids = [...xml.matchAll(/<wpml:actionId>(\d+)<\/wpml:actionId>/g)].map((x) => x[1])
    expect(new Set(ids).size).toBe(ids.length) // unique across the mission
  })

  it('DJI Fly template.kml is a stub: the route lives only in waylines.wpml', () => {
    const t = buildTemplateKml(grid, mini4, 'djifly')
    expect(parse(t).getElementsByTagName('parsererror').length).toBe(0)
    expect(t).not.toContain('<Placemark>')
    expect(t).not.toContain('<Folder>')
    expect(t).toContain('<wpml:author>fly</wpml:author>')
  })

  it('orbit waypoints face the subject', () => {
    const c: LngLat = [115.85, -31.95]
    const m = planOrbit(c, m3e, { ...defaultOrbitParams, rings: [{ altitudeM: 20, gimbalPitchDeg: -20 }], photosPerRing: 4 })
    const headings = [...buildWaylinesWpml(m, m3e, 'pilot2').matchAll(/<wpml:waypointHeadingAngle>(-?[\d.]+)</g)].map((x) => Number(x[1]))
    // First point is due south of the subject, so it must look north (0°).
    expect(Math.abs(headings[0])).toBeLessThan(1)
  })

  it('KMZ contains both wpmz files', async () => {
    const blob = await buildKmz(grid, m3e, 'pilot2')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['wpmz/template.kml', 'wpmz/waylines.wpml'])
  })

  it('refuses drones without WPML IDs', () => {
    const noIds = BUILTIN_DRONES.find((d) => !d.wpml)!
    expect(() => buildWaylinesWpml(grid, noIds, 'pilot2')).toThrow(/WPML/)
  })
})

describe('Litchi export', () => {
  it('has 15 action slots and one row per waypoint', () => {
    const m = planGrid(RECT, mini4, defaultGridParams)
    const lines = buildLitchiCsv(m).trim().split('\n')
    const header = lines[0].split(',')
    expect(header).toContain('actiontype15')
    expect(lines.length - 1).toBe(m.waypoints.length)
    for (const row of lines.slice(1)) expect(row.split(',').length).toBe(header.length)
  })
})
