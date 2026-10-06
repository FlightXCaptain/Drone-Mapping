import { create } from 'zustand'
import type { LngLat } from './domain/types'
import type { PhotoScan, PhotoSource, Quality } from './bridge'

/** What the processing panel draws on the map (not persisted). */
interface ProcessingView {
  /** Where the photos from a flight were taken, and planned shots that are missing. */
  photos: { taken: LngLat[]; missing: LngLat[] } | null
  /** A finished map shown over the satellite imagery. */
  overlay: { id: string; tiles: string; bounds: [number, number, number, number] } | null
  /** The job running now, for the progress button in the bottom bar. */
  job: { id: string; name: string; kind: 'map' | 'splat'; stage: string; pct: number } | null
  /** The last job that ended, until the user opens the processing window. */
  finished: { id: string; name: string; kind: 'map' | 'splat'; status: string } | null
  setPhotos: (p: ProcessingView['photos']) => void
  setOverlay: (o: ProcessingView['overlay']) => void
  /** Connected cards / drones with photos, kept fresh by App while the desktop app runs. */
  sources: PhotoSource[]
  /** Sources the user dismissed or already used, so the prompt doesn't nag. */
  seen: string[]
  /** What the processing window was working on, kept while it's minimised or closed. */
  form: {
    /** Every folder added to this job (e.g. one per ring or level), with the flights ticked in each. */
    scans: { scan: PhotoScan; picked: string[] }[]
    name: string | null
    quality: Quality
    /** Photogrammetry: also build the textured 3D model (most of the processing time). */
    model3d: boolean
  }
  setForm: (f: Partial<ProcessingView['form']>) => void
  setSources: (s: PhotoSource[]) => void
  markSeen: (id: string) => void
  setJob: (j: ProcessingView['job']) => void
  setFinished: (f: ProcessingView['finished']) => void
}

export const useProcessingView = create<ProcessingView>()((set) => ({
  photos: null,
  overlay: null,
  setPhotos: (photos) => set({ photos }),
  setOverlay: (overlay) => set({ overlay }),
  job: null,
  finished: null,
  form: { scans: [], name: null, quality: 'standard', model3d: true },
  setForm: (f) => set((s) => ({ form: { ...s.form, ...f } })),
  sources: [],
  seen: [],
  setSources: (sources) => set({ sources }),
  markSeen: (id) => set((s) => ({ seen: s.seen.includes(id) ? s.seen : [...s.seen, id] })),
  setJob: (job) => set({ job }),
  setFinished: (finished) => set({ finished }),
}))
