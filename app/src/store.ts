import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BUILTIN_DRONES } from './domain/drones'
import { defaultGridParams, type GridParams } from './domain/planners/grid'
import { autoRings, defaultOrbitParams, type OrbitParams } from './domain/planners/orbit'
import type { DroneProfile, LngLat } from './domain/types'

export type MissionType = 'grid' | 'orbit'
export type DrawTool = 'polygon' | 'rectangle' | 'point' | 'select' | null

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
  drawTool: DrawTool

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
  setDrawTool: (t: DrawTool) => void
}

export const usePlanner = create<PlannerState>()(
  persist(
    (set) => ({
      customDrones: [],
      droneId: BUILTIN_DRONES[0].id,
      missionType: 'grid',
      missionName: 'New mission',
      area: null,
      orbitCenter: null,
      grid: defaultGridParams,
      orbit: defaultOrbitParams,
      subjectHeightM: 15,
      ringCount: 3,
      drawTool: null,

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
      setArea: (area) => set({ area }),
      setOrbitCenter: (orbitCenter) => set({ orbitCenter }),
      updateGrid: (p) => set((s) => ({ grid: { ...s.grid, ...p } })),
      updateOrbit: (p) =>
        set((s) => {
          const orbit = { ...s.orbit, ...p }
          if (p.radiusM !== undefined && !p.rings) orbit.rings = autoRings(s.subjectHeightM, orbit.radiusM, s.ringCount)
          return { orbit }
        }),
      // Subject height / ring count regenerate the rings so pitch always aims at the subject.
      setSubjectHeight: (subjectHeightM) =>
        set((s) => ({ subjectHeightM, orbit: { ...s.orbit, rings: autoRings(subjectHeightM, s.orbit.radiusM, s.ringCount) } })),
      setRingCount: (ringCount) =>
        set((s) => ({ ringCount, orbit: { ...s.orbit, rings: autoRings(s.subjectHeightM, s.orbit.radiusM, ringCount) } })),
      setDrawTool: (drawTool) => set({ drawTool }),
    }),
    {
      name: 'drone-planner',
      version: 1,
      partialize: ({ drawTool: _drawTool, ...rest }) => rest,
    },
  ),
)

export function useAllDrones(): DroneProfile[] {
  const custom = usePlanner((s) => s.customDrones)
  return [...BUILTIN_DRONES, ...custom]
}
