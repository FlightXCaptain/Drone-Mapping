import { describe, expect, it } from 'vitest'
import { exifTime, groupFlights } from './flights'

const p = (time: string | null, name = time ?? 'x') => ({ name, time })

describe('flights', () => {
  it('reads EXIF times', () => {
    expect(exifTime('2026:10:06 11:23:45')).toBe(new Date(2026, 9, 6, 11, 23, 45).getTime())
    expect(exifTime('2026-10-06 11:23:45')).toBe(new Date(2026, 9, 6, 11, 23, 45).getTime())
    expect(exifTime(null)).toBeNull()
  })

  it('splits on long gaps, newest flight first', () => {
    const photos = [
      p('2026:10:06 09:00:00'),
      p('2026:10:06 09:00:05'),
      p('2026:10:06 09:10:00'), // 10 min later: same flight
      p('2026:10:06 10:00:00'), // 50 min later: new flight
      p('2026:10:06 10:00:03'),
    ]
    const f = groupFlights(photos)
    expect(f.map((x) => x.photos.length)).toEqual([2, 3])
    expect(f[0].start).toBe(exifTime('2026:10:06 10:00:00'))
  })

  it('keeps photos without a time', () => {
    expect(groupFlights([p(null), p(null)])[0].photos.length).toBe(2)
    expect(groupFlights([])).toEqual([])
  })
})
