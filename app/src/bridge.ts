/**
 * Route to a USB-connected DJI controller.
 *  - Desktop app (Tauri): built-in commands, callable only from this window.
 *  - Browser on the PC running `npm run dev` / `preview`: the dev-server bridge (rc-bridge.ts).
 *  - Anywhere else: unavailable, and the UI hides the feature.
 */
import { invoke } from '@tauri-apps/api/core'

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface BridgeResult {
  ok: boolean
  error?: string
  [k: string]: unknown
}

/** Required by the HTTP bridge; cross-site pages can't send it without a preflight it never approves. */
const HEADERS = { 'X-Drone-Mapping': '1' }

/** null = no route to a controller from here. */
async function viaHttp(path: string, init?: RequestInit): Promise<BridgeResult | null> {
  try {
    const res = await fetch(path, { ...init, headers: { ...HEADERS, ...(init?.headers ?? {}) } })
    if ([403, 404, 501].includes(res.status) || !res.headers.get('content-type')?.includes('json')) return null
    return (await res.json()) as BridgeResult
  } catch {
    return null
  }
}

export async function rcList(): Promise<BridgeResult | null> {
  if (isDesktop()) return invoke<BridgeResult>('rc_list')
  return viaHttp('/api/rc')
}

export async function rcFetch(mission: string): Promise<BridgeResult> {
  if (isDesktop()) return invoke<BridgeResult>('rc_fetch', { mission })
  return (await viaHttp(`/api/rc/mission/${mission}`)) ?? { ok: false, error: 'No controller connection from here.' }
}

export async function rcSend(kmzBase64: string, mission: string, whatIf = false): Promise<BridgeResult> {
  if (isDesktop()) return invoke<BridgeResult>('rc_send', { kmzBase64, mission, whatIf })
  return (
    (await viaHttp('/api/rc/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kmzBase64, mission, whatIf }),
    })) ?? { ok: false, error: 'No controller connection from here.' }
  )
}
