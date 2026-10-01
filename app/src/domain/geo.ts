import type { LngLat } from './types'

const R = 6378137 // WGS84 equatorial radius, metres
const DEG = Math.PI / 180

/**
 * Local equirectangular projection centred on `origin`. Accurate to centimetres over
 * the few-kilometre extents of a drone mission, and far simpler than a full UTM transform.
 */
export function localFrame(origin: LngLat) {
  const cosLat = Math.cos(origin[1] * DEG)
  return {
    toXY([lng, lat]: LngLat): [number, number] {
      return [(lng - origin[0]) * DEG * R * cosLat, (lat - origin[1]) * DEG * R]
    },
    toLngLat([x, y]: [number, number]): LngLat {
      return [origin[0] + x / (R * cosLat * DEG), origin[1] + y / (R * DEG)]
    },
  }
}

export function rotate([x, y]: [number, number], angleRad: number): [number, number] {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return [x * c - y * s, x * s + y * c]
}

export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG
  const dLng = (b[0] - a[0]) * DEG
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Initial bearing from a to b, degrees clockwise from north, in [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * DEG
  const φ2 = b[1] * DEG
  const Δλ = (b[0] - a[0]) * DEG
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) / DEG + 360) % 360
}

export function centroid(ring: LngLat[]): LngLat {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
    ? ring.slice(0, -1)
    : ring
  const sum = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0])
  return [sum[0] / pts.length, sum[1] / pts.length]
}
