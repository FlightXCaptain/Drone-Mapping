/** EXIF "2026:10:06 11:23:45" (or with dashes) → ms since epoch, local time. */
export function exifTime(s: string | null | undefined): number | null {
  const m = s?.match(/(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m.map(Number)
  return new Date(y, mo - 1, d, h, mi, se).getTime()
}

/** Stable id for a flight within one folder, for remembering which are ticked. */
export const flightKey = (f: { start: number; photos: unknown[] }) => `${f.start}:${f.photos.length}`

export interface Flight<T> {
  start: number
  end: number
  photos: T[]
}

/**
 * Split a card's photos into flights wherever there's a long gap between shots (a battery swap
 * or a new site). Photos without a time join the nearest flight in file order. Newest first.
 */
export function groupFlights<T extends { time: string | null }>(photos: T[], gapMin = 15): Flight<T>[] {
  const timed = photos.map((p) => ({ p, t: exifTime(p.time) })).filter((x): x is { p: T; t: number } => x.t != null)
  if (timed.length === 0) return photos.length ? [{ start: 0, end: 0, photos }] : []
  timed.sort((a, b) => a.t - b.t)
  const flights: Flight<T>[] = []
  for (const { p, t } of timed) {
    const f = flights[flights.length - 1]
    if (f && t - f.end <= gapMin * 60_000) {
      f.photos.push(p)
      f.end = t
    } else flights.push({ start: t, end: t, photos: [p] })
  }
  const untimed = photos.filter((p) => exifTime(p.time) == null)
  if (untimed.length) flights[flights.length - 1].photos.push(...untimed)
  return flights.reverse()
}
