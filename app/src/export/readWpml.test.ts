// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { buildKmz } from './wpml'
import { compareWithPlan, readKmz } from './readWpml'
import { BUILTIN_DRONES } from '../domain/drones'
import { planOrbit, defaultOrbitParams } from '../domain/planners/orbit'
import { planGrid, defaultGridParams } from '../domain/planners/grid'
import type { LngLat } from '../domain/types'

const mini4 = BUILTIN_DRONES.find((d) => d.id === 'dji-mini-4-pro')!
const m3e = BUILTIN_DRONES.find((d) => d.id === 'dji-m3e')!
const RECT: LngLat[] = [
  [115.85, -31.95],
  [115.851, -31.95],
  [115.851, -31.9505],
  [115.85, -31.9505],
  [115.85, -31.95],
]

describe('reading a mission back', () => {
  it('round-trips a DJI Fly orbit: positions, heights, pitch, photos', async () => {
    const plan = planOrbit([115.9, -32.06], mini4, { ...defaultOrbitParams, photosPerRing: 12 })
    const read = await readKmz(await buildKmz(plan, mini4, 'djifly'))
    expect(read.waypoints.length).toBe(plan.waypoints.length)
    expect(read.author).toBe('fly')
    expect(read.heightMode).toBe('relativeToStartPoint')
    read.waypoints.forEach((w, i) => {
      expect(w.heightM).toBe(plan.waypoints[i].altitudeM)
      expect(w.gimbalPitchDeg).toBe(plan.waypoints[i].gimbalPitchDeg)
      expect(w.photo).toBe(true)
    })
    expect(compareWithPlan(read, plan).matches).toBe(true)
  })

  it('round-trips a Pilot 2 grid with interval shooting', async () => {
    const plan = planGrid(RECT, m3e, defaultGridParams)
    const read = await readKmz(await buildKmz(plan, m3e, 'pilot2'))
    expect(compareWithPlan(read, plan)).toEqual({ matches: true, differences: [] })
  })

  it('reports differences in plain language', async () => {
    const plan = planOrbit([115.9, -32.06], mini4, { ...defaultOrbitParams, photosPerRing: 12 })
    const read = await readKmz(await buildKmz(plan, mini4, 'djifly'))
    read.waypoints[2].heightM += 5
    read.waypoints[4].position = [read.waypoints[4].position[0] + 0.0001, read.waypoints[4].position[1]]
    const c = compareWithPlan(read, plan)
    expect(c.matches).toBe(false)
    expect(c.differences.join(' ')).toMatch(/Waypoint 3 height/)
    expect(c.differences.join(' ')).toMatch(/Waypoint 5 is \d+\.\d m from/)
  })

  it('a different mission gets a short summary, not a per-waypoint list', async () => {
    const plan = planOrbit([115.9, -32.06], mini4, { ...defaultOrbitParams, photosPerRing: 12 })
    const other = planOrbit([115.95, -32.06], mini4, { ...defaultOrbitParams, photosPerRing: 10 })
    const c = compareWithPlan(await readKmz(await buildKmz(other, mini4, 'djifly')), plan)
    expect(c.differences.length).toBe(2)
    expect(c.differences[1]).toMatch(/km from where your plan starts/)
  })

  // A mission DJI Fly saved itself (copied off a controller), when DJI_FLY_KMZ points at one.
  const NATIVE = process.env.DJI_FLY_KMZ ?? ''
  it.skipIf(!NATIVE || !existsSync(NATIVE))('reads a mission DJI Fly wrote itself', async () => {
    const read = await readKmz(readFileSync(NATIVE).buffer as ArrayBuffer)
    expect(read.waypoints.length).toBeGreaterThan(0)
    for (const w of read.waypoints) {
      expect(Math.abs(w.position[0])).toBeLessThanOrEqual(180)
      expect(Math.abs(w.position[1])).toBeLessThanOrEqual(90)
    }
  })
})
