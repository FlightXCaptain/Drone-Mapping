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

/* ---------- Optional processing packs (desktop app only) ---------- */

export interface EnginePack {
  id: string
  title: string
  summary: string
  version: string
  installedVersion: string | null
  installed: boolean
  upToDate: boolean
  downloadBytes: number
  installedBytes: number
  path: string
}
export interface EngineStatus {
  ok: boolean
  error?: string
  windows: boolean
  freeBytes: number | null
  packs: EnginePack[]
}
export interface EngineProgress {
  pack: string
  step: 'download' | 'install' | 'done' | 'error'
  done: number
  total: number
  message: string
}

export const engineStatus = () => invoke<EngineStatus>('engine_status')
export const engineInstall = (id: string) => invoke<BridgeResult>('engine_install', { id })
export const engineRemove = (id: string) => invoke<BridgeResult>('engine_remove', { id })
export const engineCancel = () => invoke<void>('engine_cancel')
export async function onEngineProgress(cb: (p: EngineProgress) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<EngineProgress>('engine-progress', (e) => cb(e.payload))
}

/* ---------- Processing jobs (desktop app only) ---------- */

export interface Photo {
  path: string
  name: string
  lng: number
  lat: number
  alt: number | null
  time: string | null
}
export interface PhotoScan {
  ok: boolean
  error?: string
  folder: string
  photos: Photo[]
  noGps: string[]
}
export type JobKind = 'map' | 'splat'
export type Quality = 'fast' | 'standard' | 'high'
export interface Job {
  id: string
  name: string
  kind: JobKind
  quality: Quality
  /** Photogrammetry only: false = map only (fast orthophoto, no 3D model). */
  model3d?: boolean
  photos: number
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'elsewhere'
  stage: string
  startedAt: number
  seconds?: number
  error?: string
  dir: string
  bounds?: [number, number, number, number] | null
  outputs?: { orthophoto?: string; tiles?: string | null; model?: string | null; splat?: string; pointCloud?: string | null; pointCloudPly?: string | null }
}
export interface JobProgress {
  id: string
  name: string
  kind: JobKind
  stage: string
  pct: number
  line: string
}

export async function pickFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const r = await open({ directory: true, title: 'Choose the folder with the flight photos' })
  return typeof r === 'string' ? r : null
}
export const photosScan = (folder: string) => invoke<PhotoScan>('photos_scan', { folder })
export const jobStart = (kind: JobKind, name: string, photos: string[], quality: Quality, model3d = true) =>
  invoke<BridgeResult & { id?: string }>('job_start', { kind, name, photos, quality, model3d })
export const jobCancel = (id: string) => invoke<BridgeResult>('job_cancel', { id })
export const jobsList = () => invoke<{ ok: boolean; root: string; jobs: Job[]; running: string | null }>('jobs_list')
export const jobOpen = (id: string, what: 'folder' | 'model' | 'orthophoto' | 'splat') => invoke<BridgeResult>('job_open', { id, what })
export const jobExport = (id: string, dest: string) =>
  invoke<BridgeResult & { folder?: string; files?: number; bytes?: number }>('job_export', { id, dest })
export async function pickSaveFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const r = await open({ directory: true, title: 'Save the result files to…' })
  return typeof r === 'string' ? r : null
}
export const jobDelete = (id: string) => invoke<BridgeResult>('job_delete', { id })
export async function onJobProgress(cb: (p: JobProgress) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<JobProgress>('job-progress', (e) => cb(e.payload))
}
/** A local tiles folder as a MapLibre tile URL template. */
export async function tileUrl(dir: string): Promise<string> {
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  return `${convertFileSrc(dir)}/{z}/{x}/{y}.png`
}
export interface PhotoSource {
  id: string
  kind: 'drive' | 'mtp'
  label: string
  photos: number
  /** drive: the DCIM folder to read in place */
  path?: string
  /** mtp: which device folder to import */
  device?: string
  storage?: string
  folder?: string
}
/** Cards, drives and DJI USB devices holding photos. `usb` also asks DJI USB devices (slower). */
export const photoSources = (usb: boolean) => invoke<{ ok: boolean; sources: PhotoSource[] }>('photo_sources', { usb })
export const photosImport = (s: PhotoSource) =>
  invoke<BridgeResult & { folder?: string }>('photos_import', { device: s.device, storage: s.storage, folder: s.folder })
export async function onImportProgress(cb: (p: { done: number; total: number }) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<{ done: number; total: number }>('import-progress', (e) => cb(e.payload))
}
export const hardwareInfo = () => invoke<import('./domain/hardware').Hardware & { ok: boolean }>('hardware_info')
