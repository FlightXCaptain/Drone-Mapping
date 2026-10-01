import { describe, expect, it } from 'vitest'
import { decodePlan, encodePlan, planCodeFromLocation, type SharedPlan } from './share'
import { defaultGridParams } from './domain/planners/grid'

const plan: SharedPlan = {
  v: 2,
  name: 'Smith farm north paddock',
  droneId: 'dji-mini-4-pro',
  parts: [
    {
      type: 'grid',
      area: [
    [115.8500001234, -31.95],
    [115.852, -31.95],
    [115.852, -31.9509],
    [115.85, -31.9509],
    [115.8500001234, -31.95],
      ],
      grid: defaultGridParams,
    },
    { type: 'orbit', center: [115.86, -31.95] },
  ],
}

describe('share links', () => {
  it('round-trips a plan', async () => {
    const back = await decodePlan(await encodePlan(plan))
    expect(back.name).toBe(plan.name)
    expect(back.parts[0].grid).toEqual(plan.parts[0].grid)
    expect(back.parts[0].area![0][0]).toBeCloseTo(115.8500001, 7)
    expect(back.parts[1].type).toBe('orbit')
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
