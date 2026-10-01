import { describe, expect, it } from 'vitest'
import { decodePlan, encodePlan, planCodeFromLocation, type SharedPlan } from './share'
import { defaultGridParams } from './domain/planners/grid'

const plan: SharedPlan = {
  v: 1,
  name: 'Smith farm north paddock',
  type: 'grid',
  droneId: 'dji-mini-4-pro',
  area: [
    [115.8500001234, -31.95],
    [115.852, -31.95],
    [115.852, -31.9509],
    [115.85, -31.9509],
    [115.8500001234, -31.95],
  ],
  grid: defaultGridParams,
}

describe('share links', () => {
  it('round-trips a plan', async () => {
    const back = await decodePlan(await encodePlan(plan))
    expect(back.name).toBe(plan.name)
    expect(back.grid).toEqual(plan.grid)
    expect(back.area![0][0]).toBeCloseTo(115.8500001, 7)
  })

  it('stays small enough for a comfortable QR code', async () => {
    const code = await encodePlan(plan)
    expect(code.length).toBeLessThan(600)
    expect(code).toMatch(/^[\w-]+$/) // URL-safe
  })

  it('reads the code from a URL hash', () => {
    expect(planCodeFromLocation('#m=abc_-1')).toBe('abc_-1')
    expect(planCodeFromLocation('')).toBeNull()
  })

  it('rejects garbage', async () => {
    await expect(decodePlan('not-a-plan')).rejects.toThrow()
  })
})
