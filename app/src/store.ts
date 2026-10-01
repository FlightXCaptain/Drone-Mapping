import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BUILTIN_DRONES } from './domain/drones'
import { defaultGridParams, type GridParams } from './domain/planners/grid'
import { aimPitch, autoRings, defaultOrbitParams, ringRadius, type OrbitParams } from './domain/planners/orbit'
import type { DroneProfile, LngLat } from './domain/types'
import type { OrbitRing } from './domain/planners/orbit'
import type { SharedPart, SharedPlan } from './share'

export type MissionType = 'grid' | 'orbit'
/** Only used while sketching something new; existing shapes are always directly editable. */
export type DrawTool = 'polygon' | 'rectangle' | 'point' | null

/** One flight type within a mission: an area map or an orbit, with its own settings. */
export interface Part {
  id: string
  missionType: MissionType
  area: LngLat[] | null
  orbitCenter: LngLat | null
  grid: GridParams
  orbit: OrbitParams
  subjectHeightM: number
  ringCount: number
}

const PART_KEYS = ['missionType', 'area', 'orbitCenter', 'grid', 'orbit', 'subjectHeightM', 'ringCount'] as const

export function newPart(missionType: MissionType, from?: Partial<Part>): Part {
  return {
    id: crypto.randomUUID(),
    missionType,
    area: null,
    orbitCenter: null,
    grid: from?.grid ?? defaultGridParams,
    orbit: defaultOrbitParams,
    subjectHeightM: 15,
    ringCount: 3,
  }
}

/** The part being edited lives in the top-level fields (so components stay simple); this snapshots it. */
function workingCopy(s: PlannerState): Part {
  const p = { id: s.activePartId } as Part
  for (const k of PART_KEYS) (p as unknown as Record<string, unknown>)[k] = s[k]
  return p
}

function loadInto(part: Part): Partial<PlannerState> {
  const out: Partial<PlannerState> = { activePartId: part.id, drawTool: null }
  for (const k of PART_KEYS) (out as Record<string, unknown>)[k] = part[k]
  return out
}

/** All parts in flight order, with the one being edited up to date. */
export function currentParts(s: PlannerState): Part[] {
  // First run / older saves: the plan being edited hasn't been added to the list yet.
  if (!s.parts.some((p) => p.id === s.activePartId)) return [...s.parts, workingCopy(s)]
  return s.parts.map((p) => (p.id === s.activePartId ? workingCopy(s) : p))
}

export function partLabel(p: Pick<Part, 'missionType'>): string {
  return p.missionType === 'grid' ? 'Area map' : 'Orbit'
}

export interface PlannerState {
  customDrones: DroneProfile[]
  /** Flight order. The entry matching activePartId may be stale - use currentParts(). */
  parts: Part[]
  activePartId: string
  droneId: string
  missionType: MissionType
  missionName: string
  area: LngLat[] | null
  orbitCenter: LngLat | null
  grid: GridParams
  orbit: OrbitParams
  subjectHeightM: number
  ringCount: number

  // Transient UI state (not persisted)
  drawTool: DrawTool
  sendOpen: boolean
  droneEditor: DroneProfile | 'new' | null

  setDrone: (id: string) => void
  saveCustomDrone: (d: DroneProfile) => void
  deleteCustomDrone: (id: string) => void
  setMissionType: (t: MissionType) => void
  setMissionName: (n: string) => void
  setArea: (a: LngLat[] | null) => void
  setOrbitCenter: (c: LngLat | null) => void
  updateGrid: (p: Partial<GridParams>) => void
  updateOrbit: (p: Partial<OrbitParams>) => void
  setSubjectHeight: (h: number) => void
  setRingCount: (n: number) => void
  updateRing: (i: number, patch: Partial<OrbitRing>) => void
  addRing: () => void
  removeRing: (i: number) => void
  setDrawTool: (t: DrawTool) => void
  setSendOpen: (o: boolean) => void
  setDroneEditor: (d: DroneProfile | 'new' | null) => void
  addPart: (t: MissionType) => void
  selectPart: (id: string) => void
  removePart: (id: string) => void
  movePart: (id: string, dir: -1 | 1) => void
  loadPlan: (p: SharedPlan) => void
  toPlan: () => SharedPlan
}

export const usePlanner = create<PlannerState>()(
  persist(
    (set, get) => ({
      customDrones: [],
      parts: [],
      activePartId: crypto.randomUUID(),
      droneId: BUILTIN_DRONES[0].id,
      missionType: 'grid',
      missionName: 'Untitled mission',
      area: null,
      orbitCenter: null,
      grid: defaultGridParams,
      orbit: defaultOrbitParams,
      subjectHeightM: 15,
      ringCount: 3,
      drawTool: null,
      sendOpen: false,
      droneEditor: null,

      setDrone: (droneId) => set({ droneId }),
      saveCustomDrone: (d) =>
        set((s) => ({ customDrones: [...s.customDrones.filter((x) => x.id !== d.id), d], droneId: d.id })),
      deleteCustomDrone: (id) =>
        set((s) => ({
          customDrones: s.customDrones.filter((x) => x.id !== id),
          droneId: s.droneId === id ? BUILTIN_DRONES[0].id : s.droneId,
        })),
      setMissionType: (missionType) => set({ missionType, drawTool: null }),
      setMissionName: (missionName) => set({ missionName }),
      setArea: (area) => set((s) => ({ area, grid: area ? s.grid : { ...s.grid, startNear: null } })),
      setOrbitCenter: (orbitCenter) => set({ orbitCenter }),
      updateGrid: (p) => set((s) => ({ grid: { ...s.grid, ...p } })),
      updateOrbit: (p) =>
        set((s) => {
          const orbit = { ...s.orbit, ...p }
          // Changing the overall distance scales every ring, keeping heights and re-aiming the camera.
          if (p.radiusM !== undefined && !p.rings && s.orbit.radiusM > 0) {
            const k = orbit.radiusM / s.orbit.radiusM
            orbit.rings = s.orbit.rings.map((r) => {
              const radiusM = Math.round(ringRadius(r, s.orbit) * k)
              return { ...r, radiusM, gimbalPitchDeg: aimPitch(r.altitudeM, radiusM, s.subjectHeightM) }
            })
          }
          return { orbit }
        }),
      // Subject height / ring count regenerate the rings so pitch always aims at the subject.
      setSubjectHeight: (subjectHeightM) =>
        set((s) => ({ subjectHeightM, orbit: { ...s.orbit, rings: autoRings(subjectHeightM, s.orbit.radiusM, s.ringCount) } })),
      updateRing: (i, patch) =>
        set((s) => ({
          orbit: {
            ...s.orbit,
            rings: s.orbit.rings.map((r, j) => {
              if (j !== i) return r
              const next = { ...r, ...patch }
              // A new height or distance re-aims the camera unless the pitch itself was edited.
              if (patch.gimbalPitchDeg === undefined) {
                next.gimbalPitchDeg = aimPitch(next.altitudeM, ringRadius(next, s.orbit), s.subjectHeightM)
              }
              return next
            }),
          },
        })),
      addRing: () =>
        set((s) => {
          const last = s.orbit.rings.at(-1) ?? { altitudeM: s.subjectHeightM, radiusM: s.orbit.radiusM, gimbalPitchDeg: -20 }
          const altitudeM = last.altitudeM + 10
          const radiusM = ringRadius(last, s.orbit)
          const rings = [...s.orbit.rings, { altitudeM, radiusM, gimbalPitchDeg: aimPitch(altitudeM, radiusM, s.subjectHeightM) }]
          return { ringCount: rings.length, orbit: { ...s.orbit, rings } }
        }),
      removeRing: (i) =>
        set((s) => {
          if (s.orbit.rings.length <= 1) return {}
          const rings = s.orbit.rings.filter((_, j) => j !== i)
          return { ringCount: rings.length, orbit: { ...s.orbit, rings } }
        }),
      setRingCount: (ringCount) =>
        set((s) => ({ ringCount, orbit: { ...s.orbit, rings: autoRings(s.subjectHeightM, s.orbit.radiusM, ringCount) } })),
      setDrawTool: (drawTool) => set({ drawTool }),
      setSendOpen: (sendOpen) => set({ sendOpen }),
      setDroneEditor: (droneEditor) => set({ droneEditor }),
      addPart: (missionType) =>
        set((s) => {
          const parts = currentParts(s)
          // New area maps inherit height/overlap from the current one: usually the same job.
          const part = newPart(missionType, s.missionType === 'grid' ? { grid: { ...s.grid, startNear: null } } : undefined)
          return { parts: [...parts, part], ...loadInto(part), drawTool: missionType === 'grid' ? 'polygon' : 'point' }
        }),
      selectPart: (id) =>
        set((s) => {
          if (id === s.activePartId) return {}
          const parts = currentParts(s)
          const part = parts.find((p) => p.id === id)
          return part ? { parts, ...loadInto(part) } : {}
        }),
      removePart: (id) =>
        set((s) => {
          let parts = currentParts(s).filter((p) => p.id !== id)
          if (parts.length === 0) parts = [newPart(s.missionType)]
          const active = parts.find((p) => p.id === s.activePartId) ?? parts[parts.length - 1]
          return { parts, ...loadInto(active) }
        }),
      movePart: (id, dir) =>
        set((s) => {
          const parts = currentParts(s)
          const i = parts.findIndex((p) => p.id === id)
          const j = i + dir
          if (i < 0 || j < 0 || j >= parts.length) return {}
          const tmp = parts[i]
          parts[i] = parts[j]
          parts[j] = tmp
          return { parts }
        }),
      loadPlan: (plan) =>
        set((s) => {
          const parts = plan.parts.map((p) => ({ ...newPart(p.type), ...fromShared(p) }))
          return {
            missionName: plan.name,
            customDrones: plan.customDrone
              ? [...s.customDrones.filter((d) => d.id !== plan.customDrone!.id), plan.customDrone]
              : s.customDrones,
            droneId: plan.droneId,
            parts,
            ...loadInto(parts[0]),
          }
        }),
      toPlan: (): SharedPlan => {
        const s: PlannerState = get()
        const custom = s.customDrones.find((d) => d.id === s.droneId)
        return {
          v: 2,
          name: s.missionName,
          droneId: s.droneId,
          ...(custom ? { customDrone: custom } : {}),
          parts: currentParts(s).map((p) =>
            p.missionType === 'grid'
              ? { type: 'grid' as const, area: p.area, grid: p.grid }
              : { type: 'orbit' as const, center: p.orbitCenter, orbit: p.orbit, subjectHeightM: p.subjectHeightM },
          ),
        }
      },
    }),
    {
      name: 'drone-planner',
      version: 3,
      partialize: ({ drawTool: _t, sendOpen: _s, droneEditor: _d, ...rest }) => rest,
      // Fill in any settings added since the plan was saved.
      migrate: (persisted) => {
        const s = persisted as Partial<PlannerState>
        return {
          ...s,
          parts: s.parts ?? [],
          activePartId: s.activePartId || crypto.randomUUID(),
          grid: { ...defaultGridParams, ...s.grid },
          orbit: { ...defaultOrbitParams, ...s.orbit },
        } as PlannerState
      },
    },
  ),
)

export function useAllDrones(): DroneProfile[] {
  const custom = usePlanner((s) => s.customDrones)
  return [...BUILTIN_DRONES, ...custom]
}

export function useCurrentDrone(): DroneProfile {
  const drones = useAllDrones()
  const id = usePlanner((s) => s.droneId)
  return drones.find((d) => d.id === id) ?? drones[0]
}

function fromShared(p: SharedPart): Partial<Part> {
  return p.type === 'grid'
    ? { missionType: 'grid', area: p.area ?? null, grid: { ...defaultGridParams, ...p.grid } }
    : {
        missionType: 'orbit',
        orbitCenter: p.center ?? null,
        orbit: { ...defaultOrbitParams, ...p.orbit },
        subjectHeightM: p.subjectHeightM ?? 15,
        ringCount: p.orbit?.rings.length ?? 3,
      }
}
