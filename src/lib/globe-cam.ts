import { haversine } from './geo';
import type { Track } from './track';

// The ambient-globe camera geometry (Cesium engine). Pure and engine-agnostic, the
// same way chase-cam.ts isolates the MapLibre camera math: the Cesium adapter stays
// a thin shell that feeds these numbers to `camera.lookAt(center, HeadingPitchRange)`.
//
// Globe mode is the "whole Earth" showpiece — the camera holds the whole ride in
// frame and slowly orbits it. Heading is a pure function of ride *progress*
// (pose.time / duration), NOT wall-clock time: the orbit completes a fixed
// ORBIT_TURNS revolutions from ride start to finish at any playback speed, and a
// seek just jumps to that progress's heading — so the seam's "updateFrame is
// absolute, no pose-derived state" invariant (issue 09) still holds.

/** Downward tilt of the orbit camera, degrees (negative looks down at the globe). */
export const ORBIT_PITCH = -35;
/** Revolutions the camera sweeps across a whole ride, start to finish. */
export const ORBIT_TURNS = 1.5;
/** Range (target→camera, metres) is the ride span times this — frames it with margin. */
export const ORBIT_RANGE_FACTOR = 2.4;
/** Range floor (metres) so a short ride still sits back far enough to read as a globe. */
export const ORBIT_MIN_RANGE = 4000;

export interface OrbitShot {
  /** Compass heading of the camera around the target, degrees 0..360. */
  heading: number;
  /** Downward pitch, degrees (constant `ORBIT_PITCH`). */
  pitch: number;
  /** Distance from the look-at target to the camera, metres. */
  range: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  ele: number; // m — the look-at target height (mean ride elevation)
}

/** Normalise degrees into [0, 360). */
function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Lat/lon bounding box of the whole track. */
function trackBounds(track: Track): Bounds {
  const { lat, lon } = track.data;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (let i = 0; i < track.n; i++) {
    if (lat[i] < minLat) minLat = lat[i];
    if (lat[i] > maxLat) maxLat = lat[i];
    if (lon[i] < minLon) minLon = lon[i];
    if (lon[i] > maxLon) maxLon = lon[i];
  }
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Orbit shot at ride `progress` (0 at the start, 1 at the end — `pose.time /
 * track.duration`) for a precomputed `range`. Heading sweeps `ORBIT_TURNS` full
 * turns across the ride; pitch and range are constant per ride.
 */
export function orbitShot(progress: number, range: number): OrbitShot {
  return {
    heading: wrap360(360 * ORBIT_TURNS * progress),
    pitch: ORBIT_PITCH,
    range,
  };
}

/**
 * The range that frames the whole ride: its end-to-end-ish span (the bounding-box
 * diagonal) scaled by `ORBIT_RANGE_FACTOR`, floored at `ORBIT_MIN_RANGE`.
 */
export function orbitRange(track: Track): number {
  const b = trackBounds(track);
  const diagonal = haversine({ lat: b.minLat, lon: b.minLon }, { lat: b.maxLat, lon: b.maxLon });
  return Math.max(ORBIT_MIN_RANGE, diagonal * ORBIT_RANGE_FACTOR);
}

/** The ride's bounding-box centre and mean elevation — the constant orbit target. */
export function trackCenter(track: Track): GeoPoint {
  const b = trackBounds(track);
  const { ele } = track.data;
  let eleSum = 0;
  for (let i = 0; i < track.n; i++) eleSum += ele[i];
  return {
    lat: (b.minLat + b.maxLat) / 2,
    lon: (b.minLon + b.maxLon) / 2,
    ele: eleSum / track.n,
  };
}
