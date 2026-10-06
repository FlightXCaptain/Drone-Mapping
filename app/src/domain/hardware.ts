/** What the desktop app reports about this PC (see jobs.rs `hardware_info`). */
export interface Hardware {
  ramGb: number
  cores: number
  gpus: { name: string; vramGb: number }[]
}

export type Quality = 'fast' | 'standard' | 'high'
export type Rating = 'good' | 'ok' | 'slow' | 'no'
export interface Fit {
  rating: Rating
  /** One plain sentence: what to expect, and what would help. */
  message: string
  /** Rough run time, when there are photos to estimate from. */
  minutes: number | null
}

const RANK: Rating[] = ['good', 'ok', 'slow', 'no']
const worst = (a: Rating, b: Rating): Rating => (RANK.indexOf(a) > RANK.indexOf(b) ? a : b)

export function duration(min: number): string {
  if (min < 2) return 'a minute or two'
  if (min < 90) return `about ${Math.round(min / 5) * 5 || Math.round(min)} min`
  return `about ${(min / 60).toFixed(min < 600 ? 1 : 0)} hours`
}

/** Integrated graphics share system memory and are far slower at training splats. */
export function isIntegrated(gpu: { name: string; vramGb: number }): boolean {
  const n = gpu.name.toLowerCase()
  if (/microsoft basic|remote display|virtual/.test(n)) return true
  if (n.includes('intel') && !n.includes('arc')) return true
  if (/radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/.test(n)) return true
  return gpu.vramGb < 2
}

/** The graphics card a splat trainer would pick: the one with the most dedicated memory. */
export function bestGpu(hw: Hardware) {
  const real = hw.gpus.filter((g) => !/microsoft basic|remote display/i.test(g.name))
  return [...real].sort((a, b) => Number(isIntegrated(a)) - Number(isIntegrated(b)) || b.vramGb - a.vramGb)[0] ?? null
}

/*
 * OpenDroneMap is limited by memory and processor threads. Per-photo minutes are for an 8-thread
 * PC, measured on this project's test runs (41 photos at Fast took 22 min on 14 threads) and
 * scaled for the others. Higher quality also needs more memory per photo.
 */
const ODM_MIN_PER_PHOTO: Record<Quality, number> = { fast: 0.9, standard: 1.8, high: 4.5 }
const ODM_PHOTOS_PER_GB: Record<Quality, number> = { fast: 22, standard: 15, high: 7 }

export function mapFit(hw: Hardware, photos: number, quality: Quality = 'standard'): Fit {
  const comfortable = Math.round(hw.ramGb * ODM_PHOTOS_PER_GB[quality])
  const speed = Math.min(2, Math.max(0.4, hw.cores / 8))
  const minutes = photos > 0 ? (photos * ODM_MIN_PER_PHOTO[quality]) / speed : null
  const spec = `${Math.round(hw.ramGb)} GB memory, ${hw.cores} threads`
  const time = minutes != null ? ` ${cap(duration(minutes))} for ${photos} photos.` : ''

  if (hw.ramGb < 7.5) return { rating: 'no', message: `${spec}. OpenDroneMap needs at least 8 GB of memory; use another PC.`, minutes }
  if (photos > comfortable * 1.5)
    return {
      rating: 'no',
      message: `${spec}: ${photos} photos at this quality will likely run out of memory. Use a lower quality or split the job (about ${comfortable} photos is comfortable).`,
      minutes,
    }
  let rating: Rating = hw.ramGb >= 31 && hw.cores >= 8 ? 'good' : hw.ramGb >= 15.5 && hw.cores >= 4 ? 'ok' : 'slow'
  if (photos > comfortable) rating = worst(rating, 'slow')
  if (minutes != null && minutes > 240) rating = worst(rating, 'slow')
  else if (minutes != null && minutes > 90) rating = worst(rating, 'ok')
  const advice =
    rating === 'good' ? '' : photos > comfortable ? ` Fewer than ${comfortable} photos would be safer.` : quality !== 'fast' ? ' Fast is quicker.' : ''
  return { rating, message: `${spec}.${time}${advice}`, minutes }
}

/*
 * Splats: COLMAP places the cameras on the processor, then Brush trains on the graphics card.
 * Training speed (steps per second) depends almost entirely on the card.
 */
const BRUSH_STEPS: Record<Quality, number> = { fast: 5000, standard: 15000, high: 30000 }
const COLMAP_MIN_PER_PHOTO: Record<Quality, number> = { fast: 0.15, standard: 0.3, high: 0.6 }

/* Measured: Intel built-in graphics ran ~20 steps/s on a small test splat; full-size ones
 * slow down as the splat grows, so plan on less. Dedicated cards run several times faster. */
function stepsPerSecond(gpu: { name: string; vramGb: number }): number {
  if (isIntegrated(gpu)) return 6
  if (gpu.vramGb >= 11.5) return 50
  if (gpu.vramGb >= 7.5) return 35
  return 18
}

export function splatFit(hw: Hardware, photos = 0, quality: Quality = 'standard'): Fit {
  const gpu = bestGpu(hw)
  if (!gpu) return { rating: 'no', message: 'No graphics card found. Splats need one; use another PC.', minutes: null }
  const speed = Math.min(2, Math.max(0.4, hw.cores / 8))
  const train = BRUSH_STEPS[quality] / stepsPerSecond(gpu) / 60
  const minutes = photos > 0 ? train + (photos * COLMAP_MIN_PER_PHOTO[quality]) / speed : null
  const time = minutes != null ? ` ${cap(duration(minutes))} for ${photos} photos.` : ` Training alone takes ${duration(train)}.`

  if (isIntegrated(gpu)) {
    const rating: Rating = train > 240 ? 'no' : train > 30 || (minutes ?? 0) > 60 ? 'slow' : 'ok'
    return {
      rating,
      message: `${gpu.name} is built-in graphics.${time} An NVIDIA or AMD graphics card (8 GB+) is several times faster${quality === 'fast' ? '' : '; Fast helps'}.`,
      minutes,
    }
  }
  const mem = `${gpu.name}, ${Math.round(gpu.vramGb)} GB.`
  if (quality === 'high' && gpu.vramGb < 7.5)
    return { rating: 'slow', message: `${mem}${time} High may run out of graphics memory; Standard is safer.`, minutes }
  let rating: Rating = gpu.vramGb >= 7.5 ? 'good' : gpu.vramGb >= 3.5 ? 'ok' : 'slow'
  if (minutes != null && minutes > 180) rating = worst(rating, 'slow')
  else if (minutes != null && minutes > 60) rating = worst(rating, 'ok')
  return { rating, message: `${mem}${time}`, minutes }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
