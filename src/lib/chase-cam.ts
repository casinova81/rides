import { offset } from './geo';
import type { Track } from './track';
import type { RidePose } from './types';

// The chase-cam geometry (issue 07 / ticket 4c). Pure and engine-agnostic so the
// MapLibre adapter stays a thin shell over it. MapLibre has no FreeCameraOptions,
// so the adapter feeds this ground point + altitude into
// `calculateCameraOptionsFromTo`. Camera–terrain collision is unhandled upstream
// and `queryTerrainElevation` is unreliable (terrain research, issue 01), so the
// altitude is clamped from the GPX's own elevations in a trailing window — never
// a terrain query. Carsten's approved prototype defaults are the locked numbers.

/** Ground distance the camera trails the marker, metres (issue 07). */
export const CHASE_BEHIND = 130;
/** Camera height above the marker before clamping, metres (issue 07). */
export const CHASE_ABOVE = 55;
/** Minimum air gap kept above the trailing terrain peak, metres (issue 07). */
export const CHASE_CLEARANCE = 12;
/** Half-width of the trailing elevation window sampled for the clamp, metres. */
export const CHASE_WINDOW_HALF = 60;

export interface ChaseCamera {
  /** Where the camera sits on the ground, [lng, lat]. */
  cameraLngLat: [number, number];
  /** Camera altitude (metres, absolute), already clamped above the terrain. */
  cameraAltitude: number;
  /** The look-at target's altitude — the marker's smoothed elevation. */
  targetAltitude: number;
  /** True when the raw (marker + height) altitude was raised to clear terrain. */
  clamped: boolean;
}

/**
 * Geometry for a behind-the-bike chase camera at `pose`. The camera trails
 * `CHASE_BEHIND` metres along the reverse travel bearing and rides `CHASE_ABOVE`
 * metres over the marker, but is lifted so it never drops below the highest GPX
 * elevation in a window around its own ground point (+ a clearance margin).
 */
export function chaseCamera(track: Track, pose: RidePose): ChaseCamera {
  const [lon, lat] = pose.lngLat;

  const ground = offset({ lat, lon }, (pose.bearing + 180) % 360, CHASE_BEHIND);
  const rawAlt = pose.elevation + CHASE_ABOVE;
  const trailingPeak = track.maxElevationNear(
    Math.max(0, pose.distance - CHASE_BEHIND),
    CHASE_WINDOW_HALF,
  );
  const minAlt = trailingPeak + CHASE_CLEARANCE;
  const clamped = rawAlt < minAlt;

  return {
    cameraLngLat: [ground.lon, ground.lat],
    cameraAltitude: clamped ? minAlt : rawAlt,
    targetAltitude: pose.elevation,
    clamped,
  };
}
