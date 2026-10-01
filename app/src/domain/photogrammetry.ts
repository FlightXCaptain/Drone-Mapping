import type { CameraSpec } from './types'

/** Ground sample distance in cm/pixel at a given altitude above ground. */
export function gsdCm(camera: CameraSpec, altitudeM: number): number {
  return (camera.sensorWidthMm * altitudeM * 100) / (camera.focalLengthMm * camera.imageWidthPx)
}

/** Altitude needed to achieve a target GSD. Inverse of gsdCm. */
export function altitudeForGsd(camera: CameraSpec, targetGsdCm: number): number {
  return (targetGsdCm * camera.focalLengthMm * camera.imageWidthPx) / (camera.sensorWidthMm * 100)
}

/**
 * Ground footprint of one nadir photo. The camera is assumed to be in landscape with its
 * long edge perpendicular to the direction of travel (DJI default for mapping).
 */
export function footprintM(camera: CameraSpec, altitudeM: number) {
  return {
    acrossTrackM: (camera.sensorWidthMm * altitudeM) / camera.focalLengthMm,
    alongTrackM: (camera.sensorHeightMm * altitudeM) / camera.focalLengthMm,
  }
}

/** Distance between flight lines and between photos for the requested overlaps (0–1). */
export function gridSpacing(
  camera: CameraSpec,
  altitudeM: number,
  frontOverlap: number,
  sideOverlap: number,
) {
  const fp = footprintM(camera, altitudeM)
  return {
    lineSpacingM: fp.acrossTrackM * (1 - sideOverlap),
    photoSpacingM: fp.alongTrackM * (1 - frontOverlap),
  }
}

/** Fastest ground speed at which the camera can still keep up with the photo spacing. */
export function maxSpeedForInterval(photoSpacingM: number, minPhotoIntervalS: number): number {
  return photoSpacingM / minPhotoIntervalS
}
