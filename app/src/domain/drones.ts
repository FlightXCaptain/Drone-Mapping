import type { CameraSpec, DroneProfile } from './types'

/*
 * Built-in aircraft. Sources:
 *  - WPML enum IDs for Enterprise aircraft: DJI Cloud API WPML docs (official).
 *  - WPML IDs for DJI Fly aircraft (68/0): community-reported from DJI Fly-authored KMZs.
 *  - Camera geometry: DJI spec sheets; real focal length derived from 35mm-equivalent.
 *    Check it against the EXIF FocalLength of a real photo before relying on GSD figures.
 * Camera specs assume the default 12 MP / binned photo mode for quad-Bayer sensors, because
 * full-resolution modes have multi-second capture intervals that don't suit mapping.
 */

const HASSELBLAD_4_3: CameraSpec = {
  sensorWidthMm: 17.3,
  sensorHeightMm: 13.0,
  focalLengthMm: 12.29,
  imageWidthPx: 5280,
  imageHeightPx: 3956,
}

const SENSOR_1_1_3_BINNED: CameraSpec = {
  sensorWidthMm: 9.6,
  sensorHeightMm: 7.2,
  focalLengthMm: 6.7,
  imageWidthPx: 4032,
  imageHeightPx: 3024,
}

const SENSOR_1IN_50MP_BINNED: CameraSpec = {
  sensorWidthMm: 13.1,
  sensorHeightMm: 9.8,
  focalLengthMm: 9.0,
  imageWidthPx: 4096,
  imageHeightPx: 3072,
}

const DJI_FLY_IDS = { droneEnumValue: 68, droneSubEnumValue: 0, payloadEnumValue: 0, payloadSubEnumValue: 0 }
const DJI_FLY_NOTE =
  'DJI Fly: max 200 waypoints. Distance-interval shooting is unreliable, so prefer "Waypoint per photo". WPML IDs are community-reported; if DJI Fly rejects the file, copy droneInfo from a mission saved on your controller.'

const flyDrone = (
  id: string,
  name: string,
  camera: CameraSpec,
  flightTimeMin: number,
  maxSpeedMs: number,
  extraNote = '',
): DroneProfile => ({
  id,
  name,
  builtin: true,
  camera,
  maxSpeedMs,
  flightTimeMin,
  minPhotoIntervalS: 2,
  maxWaypoints: 200,
  exportTargets: ['djifly', 'litchi'],
  wpml: DJI_FLY_IDS,
  notes: extraNote ? `${extraNote} ${DJI_FLY_NOTE}` : DJI_FLY_NOTE,
})

export const BUILTIN_DRONES: DroneProfile[] = [
  // ---- Enterprise (DJI Pilot 2) – official WPML IDs -------------------------------------
  {
    id: 'dji-m3e',
    name: 'DJI Mavic 3 Enterprise (M3E)',
    builtin: true,
    camera: HASSELBLAD_4_3,
    maxSpeedMs: 15,
    flightTimeMin: 45,
    minPhotoIntervalS: 0.7,
    maxWaypoints: 65535,
    exportTargets: ['pilot2'],
    wpml: { droneEnumValue: 77, droneSubEnumValue: 0, payloadEnumValue: 66, payloadSubEnumValue: 0 },
    notes: 'Mechanical shutter, 0.7 s interval. The best all-round mapping aircraft here.',
  },
  {
    id: 'dji-m3m',
    name: 'DJI Mavic 3 Multispectral (M3M) – RGB',
    builtin: true,
    camera: { sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 12.29, imageWidthPx: 5280, imageHeightPx: 3956 },
    maxSpeedMs: 15,
    flightTimeMin: 43,
    minPhotoIntervalS: 2,
    maxWaypoints: 65535,
    exportTargets: ['pilot2'],
    wpml: { droneEnumValue: 77, droneSubEnumValue: 2, payloadEnumValue: 68, payloadSubEnumValue: 0 },
  },
  {
    id: 'dji-m3t',
    name: 'DJI Mavic 3 Thermal (M3T) – wide',
    builtin: true,
    camera: { sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.4, imageWidthPx: 8000, imageHeightPx: 6000 },
    maxSpeedMs: 15,
    flightTimeMin: 45,
    minPhotoIntervalS: 2,
    maxWaypoints: 65535,
    exportTargets: ['pilot2'],
    wpml: { droneEnumValue: 77, droneSubEnumValue: 1, payloadEnumValue: 67, payloadSubEnumValue: 0 },
  },
  {
    id: 'dji-m4e',
    name: 'DJI Matrice 4E',
    builtin: true,
    camera: HASSELBLAD_4_3,
    maxSpeedMs: 21,
    flightTimeMin: 49,
    minPhotoIntervalS: 0.5,
    maxWaypoints: 65535,
    exportTargets: ['pilot2'],
    wpml: { droneEnumValue: 99, droneSubEnumValue: 0, payloadEnumValue: 88, payloadSubEnumValue: 0 },
  },
  {
    id: 'dji-m4t',
    name: 'DJI Matrice 4T – wide',
    builtin: true,
    camera: { sensorWidthMm: 9.6, sensorHeightMm: 7.2, focalLengthMm: 6.7, imageWidthPx: 4032, imageHeightPx: 3024 },
    maxSpeedMs: 21,
    flightTimeMin: 49,
    minPhotoIntervalS: 1,
    maxWaypoints: 65535,
    exportTargets: ['pilot2'],
    wpml: { droneEnumValue: 99, droneSubEnumValue: 1, payloadEnumValue: 89, payloadSubEnumValue: 2 },
  },
  {
    id: 'dji-m3d',
    name: 'DJI Matrice 3D (Dock 2)',
    builtin: true,
    camera: HASSELBLAD_4_3,
    maxSpeedMs: 15,
    flightTimeMin: 50,
    minPhotoIntervalS: 0.7,
    maxWaypoints: 65535,
    exportTargets: ['pilot2'],
    wpml: { droneEnumValue: 91, droneSubEnumValue: 0, payloadEnumValue: 80, payloadSubEnumValue: 0 },
  },
  {
    id: 'dji-m30',
    name: 'DJI M30 – wide',
    builtin: true,
    camera: { sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 },
    maxSpeedMs: 23,
    flightTimeMin: 41,
    minPhotoIntervalS: 2,
    maxWaypoints: 65535,
    exportTargets: ['pilot2'],
    wpml: { droneEnumValue: 67, droneSubEnumValue: 0, payloadEnumValue: 52, payloadSubEnumValue: 0 },
  },

  // ---- Consumer with DJI Fly waypoints -----------------------------------------------------
  flyDrone('dji-mini-4-pro', 'DJI Mini 4 Pro', SENSOR_1_1_3_BINNED, 34, 12),
  flyDrone('dji-mini-5-pro', 'DJI Mini 5 Pro', SENSOR_1IN_50MP_BINNED, 36, 15, 'Sensor size not yet confirmed.'),
  flyDrone('dji-air-3', 'DJI Air 3 – wide', SENSOR_1_1_3_BINNED, 46, 12),
  flyDrone('dji-air-3s', 'DJI Air 3S – wide', SENSOR_1IN_50MP_BINNED, 45, 15, 'Sensor size not yet confirmed.'),
  flyDrone('dji-mavic-3-pro', 'DJI Mavic 3 Pro – Hasselblad', HASSELBLAD_4_3, 43, 15),
  flyDrone('dji-mavic-3-classic', 'DJI Mavic 3 / Classic', HASSELBLAD_4_3, 46, 15),
  flyDrone(
    'dji-mavic-4-pro',
    'DJI Mavic 4 Pro – Hasselblad',
    { sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 14, imageWidthPx: 6144, imageHeightPx: 4608 },
    51,
    15,
    'Camera geometry still to be verified from EXIF.',
  ),

  // ---- No native waypoints → Litchi -------------------------------------------------------
  {
    id: 'dji-mini-3-pro',
    name: 'DJI Mini 3 / Mini 3 Pro',
    builtin: true,
    camera: SENSOR_1_1_3_BINNED,
    maxSpeedMs: 12,
    flightTimeMin: 34,
    minPhotoIntervalS: 2,
    maxWaypoints: 99,
    exportTargets: ['litchi'],
    notes: 'No DJI Fly waypoints. Fly with Litchi (Android, beta support).',
  },
  {
    id: 'dji-mini-2',
    name: 'DJI Mini 2 / Mini SE',
    builtin: true,
    camera: { sensorWidthMm: 6.17, sensorHeightMm: 4.55, focalLengthMm: 4.49, imageWidthPx: 4000, imageHeightPx: 3000 },
    maxSpeedMs: 10,
    flightTimeMin: 31,
    minPhotoIntervalS: 2,
    maxWaypoints: 99,
    exportTargets: ['litchi'],
    notes: 'No DJI Fly waypoints. Fly with Litchi.',
  },
  {
    id: 'dji-air-2s',
    name: 'DJI Air 2S',
    builtin: true,
    camera: { sensorWidthMm: 13.2, sensorHeightMm: 8.8, focalLengthMm: 8.4, imageWidthPx: 5472, imageHeightPx: 3648 },
    maxSpeedMs: 15,
    flightTimeMin: 31,
    minPhotoIntervalS: 2,
    maxWaypoints: 99,
    exportTargets: ['litchi'],
    notes: 'No DJI Fly waypoints. Fly with Litchi.',
  },
]
