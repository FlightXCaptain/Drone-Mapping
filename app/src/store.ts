import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BUILTIN_DRONES } from './domain/drones'
import { defaultGridParams, type GridParams } from './domain/planners/grid'
import { aimPitch, autoRings, defaultOrbitParams, ringRadius, type OrbitParams } from './domain/planners/orbit'
import type { DroneProfile, LngLat } from './domain/types'
import type { OrbitRing } from './domain/planners/orbit'
import type { SharedPlan } from './share'

export type MissionType = 'grid' | 'orbit'
/** Only used while sketching something new; existing shapes are always directly editable. */
export type DrawTool = 'polygon' | 'rectangle' | 'point' | null

interface PlannerState {
  customDrones: DroneProfile[]
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
  loadPlan: (p: SharedPlan) => void
  toPlan: () => SharedPlan
}

export const usePlanner = create<PlannerState>()(
  persist(
    (set, get) => ({
      customDrones: [],
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
      loadPlan: (p) =>
        set((s) => ({
          missionName: p.name,
          missionType: p.type,
          customDrones: p.customDrone ? [...s.customDrones.filter((d) => d.id !== p.customDrone!.id), p.customDrone] : s.customDrones,
          droneId: p.droneId,
          area: p.area ?? (p.type === 'grid' ? null : s.area),
          orbitCenter: p.center ?? (p.type === 'orbit' ? null : s.orbitCenter),
          grid: p.grid ? { ...defaultGridParams, ...p.grid } : s.grid,
          orbit: p.orbit ? { ...defaultOrbitParams, ...p.orbit } : s.orbit,
          subjectHeightM: p.subjectHeightM ?? s.subjectHeightM,
          ringCount: p.orbit?.rings.length ?? s.ringCount,
          drawTool: null,
        })),
      toPlan: (): SharedPlan => {
        const s: PlannerState = get()
        const custom = s.customDrones.find((d) => d.id === s.droneId)
        return {
          v: 1,
          name: s.missionName,
          type: s.missionType,
          droneId: s.droneId,
          ...(custom ? { customDrone: custom } : {}),
          ...(s.missionType === 'grid'
            ? { area: s.area, grid: s.grid }
            : { center: s.orbitCenter, orbit: s.orbit, subjectHeightM: s.subjectHeightM }),
        }
      },
    }),
    {
      name: 'drone-planner',
      version: 2,
      partialize: ({ drawTool: _t, sendOpen: _s, droneEditor: _d, ...rest }) => rest,
      // Fill in any settings added since the plan was saved.
      migrate: (persisted) => {
        const s = persisted as Partial<PlannerState>
        return {
          ...s,
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
