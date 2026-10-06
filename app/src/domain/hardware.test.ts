import { describe, expect, it } from 'vitest'
import { bestGpu, duration, isIntegrated, mapFit, splatFit, type Hardware } from './hardware'

const laptop: Hardware = { ramGb: 31.5, cores: 14, gpus: [{ name: 'Intel(R) Graphics', vramGb: 2 }] }
const gamer: Hardware = {
  ramGb: 32,
  cores: 16,
  gpus: [
    { name: 'Intel(R) UHD Graphics 770', vramGb: 0.1 },
    { name: 'NVIDIA GeForce RTX 4070', vramGb: 12 },
  ],
}

describe('hardware fit', () => {
  it('spots built-in graphics', () => {
    expect(isIntegrated({ name: 'Intel(R) Graphics', vramGb: 2 })).toBe(true)
    expect(isIntegrated({ name: 'Intel(R) Arc(TM) A770', vramGb: 16 })).toBe(false)
    expect(isIntegrated({ name: 'AMD Radeon(TM) Graphics', vramGb: 0.5 })).toBe(true)
    expect(isIntegrated({ name: 'AMD Radeon RX 7800 XT', vramGb: 16 })).toBe(false)
  })

  it('picks the dedicated card over built-in graphics', () => {
    expect(bestGpu(gamer)?.name).toBe('NVIDIA GeForce RTX 4070')
  })

  it('rates splats by graphics card and quality', () => {
    expect(splatFit(laptop, 40, 'fast').rating).toBe('ok') // ~14 min on built-in graphics
    expect(splatFit(laptop, 40, 'high').rating).toBe('slow') // about 1.5 hours
    expect(splatFit(gamer, 40, 'standard').rating).toBe('good')
    expect(splatFit({ ...gamer, gpus: [{ name: 'NVIDIA GeForce GTX 1650', vramGb: 4 }] }, 40, 'high').rating).toBe('slow')
    expect(splatFit({ ...gamer, gpus: [] }).rating).toBe('no')
  })

  it('rates maps by memory, photo count and quality', () => {
    const mid = { ...laptop, ramGb: 16, cores: 8 }
    expect(mapFit(laptop, 40, 'fast').rating).toBe('good')
    expect(mapFit(mid, 40, 'standard').rating).toBe('ok')
    expect(mapFit(mid, 300, 'standard').rating).toBe('slow')
    expect(mapFit(mid, 300, 'high').rating).toBe('no') // too many photos for 16 GB at High
    expect(mapFit({ ...laptop, ramGb: 4 }, 20).rating).toBe('no')
  })

  it('changes the estimate with quality', () => {
    const fast = mapFit(laptop, 41, 'fast').minutes!
    const high = mapFit(laptop, 41, 'high').minutes!
    expect(fast).toBeGreaterThan(15) // the 41-photo Fast test run took 22 min on this kind of PC
    expect(fast).toBeLessThan(30)
    expect(high).toBeGreaterThan(fast * 3)
    expect(mapFit(laptop, 41, 'fast').message).toMatch(/for 41 photos/)
  })

  it('says durations plainly', () => {
    expect(duration(1)).toBe('a minute or two')
    expect(duration(22)).toBe('about 20 min')
    expect(duration(150)).toBe('about 2.5 hours')
  })
})
