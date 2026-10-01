/** [lng, lat] in WGS84 degrees, GeoJSON order. */
export type LngLat = [number, number]

export interface CameraSpec {
  sensorWidthMm: number
  sensorHeightMm: number
  /** Real (not 35mm-equivalent) focal length. */
  focalLengthMm: number
  imageWidthPx: number
  imageHeightPx: number
}

/** How a mission physically gets onto the aircraft. */
export type ExportTarget =
  | 'pilot2' // DJI Pilot 2 / FlightHub 2 – native WPML KMZ import
  | 'djifly' // DJI Fly – WPML KMZ via the waypoint-file replacement workaround
  | 'litchi' // Litchi Mission Hub CSV – for drones with no native waypoints

export interface WpmlIds {
  droneEnumValue: number
  droneSubEnumValue: number
  payloadEnumValue: number
  payloadSubEnumValue: number
}

export interface DroneProfile {
  id: string
  name: string
  builtin: boolean
  camera: CameraSpec
  maxSpeedMs: number
  /** Rated hover/flight time in minutes, as advertised. */
  flightTimeMin: number
  /** Fastest sustained interval-shooting rate the camera can keep up with. */
  minPhotoIntervalS: number
  /** Hard cap on waypoints the target app will accept. */
  maxWaypoints: number
  exportTargets: ExportTarget[]
  wpml?: WpmlIds
  notes?: string
}

export type WaypointAction =
  | { type: 'takePhoto' }
  | { type: 'gimbalPitch'; pitchDeg: number }
  | { type: 'hover'; seconds: number }

export interface Waypoint {
  position: LngLat
  /** Metres above the take-off point. */
  altitudeM: number
  speedMs: number
  /** Aircraft heading in degrees (0 = north, clockwise). Undefined = follow route. */
  headingDeg?: number
  /** Aim the aircraft at this point (orbits). Takes precedence over headingDeg. */
  poi?: LngLat
  gimbalPitchDeg: number
  actions: WaypointAction[]
}

/** Continuous "take a photo every N metres" between two waypoint indices (inclusive). */
export interface IntervalSegment {
  startIndex: number
  endIndex: number
  distanceM: number
}

export interface Mission {
  name: string
  droneId: string
  waypoints: Waypoint[]
  intervalSegments: IntervalSegment[]
  /** Planned photo positions, for map preview and stats (independent of trigger method). */
  photoPoints: LngLat[]
}

export interface MissionStats {
  distanceM: number
  durationS: number
  photoCount: number
  waypointCount: number
  batteries: number
  gsdCm: number | null
  areaM2: number | null
  warnings: string[]
}
