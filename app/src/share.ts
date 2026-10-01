import type { GridParams } from './domain/planners/grid'
import type { OrbitParams } from './domain/planners/orbit'
import type { DroneProfile, LngLat } from './domain/types'
import type { MissionType } from './store'

/**
 * A plan small enough to travel inside a URL / QR code: the shape plus settings, not the
 * generated waypoints (the receiving device re-plans it, which is instant and identical).
 * Custom aircraft travel with the plan so the receiver needn't have them saved.
 */
export interface SharedPart {
  type: MissionType
  area?: LngLat[] | null
  center?: LngLat | null
  grid?: GridParams
  orbit?: OrbitParams
  subjectHeightM?: number
}

export interface SharedPlan {
  v: 2
  name: string
  droneId: string
  customDrone?: DroneProfile
  parts: SharedPart[]
}

/** Links made before multi-part missions carried a single part inline. */
type SharedPlanV1 = SharedPart & { v: 1; name: string; droneId: string; customDrone?: DroneProfile }

const round = (p: LngLat): LngLat => [Number(p[0].toFixed(7)), Number(p[1].toFixed(7))] // ~1 cm

function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function encodePlan(plan: SharedPlan): Promise<string> {
  const compact: SharedPlan = {
    ...plan,
    parts: plan.parts.map((p) => ({
      ...p,
      area: p.area?.map(round),
      center: p.center ? round(p.center) : p.center,
      grid: p.grid ? { ...p.grid, startNear: p.grid.startNear ? round(p.grid.startNear) : null } : undefined,
    })),
  }
  const json = new TextEncoder().encode(JSON.stringify(compact))
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))
}

export async function decodePlan(code: string): Promise<SharedPlan> {
  const json = await pipe(fromBase64Url(code), new DecompressionStream('deflate-raw'))
  const raw = JSON.parse(new TextDecoder().decode(json)) as SharedPlan | SharedPlanV1
  const plan: SharedPlan =
    raw.v === 1
      ? { v: 2, name: raw.name, droneId: raw.droneId, customDrone: raw.customDrone, parts: [{ ...raw, v: undefined } as SharedPart] }
      : raw
  if (plan.v !== 2 || !plan.parts?.length || plan.parts.some((p) => p.type !== 'grid' && p.type !== 'orbit')) {
    throw new Error('This mission link is not valid.')
  }
  return plan
}

export const PLAN_PARAM = 'm'

export async function planUrl(plan: SharedPlan, origin = window.location.origin + window.location.pathname): Promise<string> {
  return `${origin}#${PLAN_PARAM}=${await encodePlan(plan)}`
}

/** Plan code from the current URL, if the page was opened from a share link. */
export function planCodeFromLocation(hash = window.location.hash): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get(PLAN_PARAM)
}
