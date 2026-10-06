import { describe, expect, it } from 'vitest'
import { coverage } from './coverage'
import type { LngLat } from './types'

const planned: LngLat[] = [
  [115.85, -31.95],
  [115.8505, -31.95],
  [115.851, -31.95],
]

describe('coverage', () => {
  it('counts shots within a few metres as taken', () => {
    // ~3 m off the first two shots, nothing near the third, plus one photo far away.
    const taken: LngLat[] = [
      [115.85003, -31.95],
      [115.8505, -31.95002],
      [115.9, -31.9],
    ]
    const c = coverage(planned, taken)
    expect(c.found).toBe(2)
    expect(c.missing).toEqual([[115.851, -31.95]])
    expect(c.unplanned).toBe(1)
  })

  it('with no plan, every photo is unplanned', () => {
    expect(coverage([], [[115.85, -31.95]])).toEqual({ found: 0, missing: [], unplanned: 1 })
  })
})
