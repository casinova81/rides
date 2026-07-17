import { describe, it, expect } from 'vitest';
import {
  chaseCamera,
  CHASE_BEHIND,
  CHASE_ABOVE,
  CHASE_CLEARANCE,
} from './chase-cam';
import { Track } from './track';
import { offset, haversine, bearingBetween } from './geo';
import type { LatLon } from './geo';
import type { Track as TrackData } from './types';
import type { RidePose } from './types';

// The chase-cam geometry (issue 07 / ticket 4c). Pure and engine-agnostic: it
// computes where the camera sits (behind the marker along the reverse bearing)
// and how high (marker + height, but clamped up to a trailing GPX-elevation max
// so the camera never sinks into a hill — queryTerrainElevation is deliberately
// never used, per the resolved terrain research). The MapLibre adapter feeds this
// into calculateCameraOptionsFromTo; here we verify the math the browser can't.

/** A straight eastbound track with per-point elevations (metres), 10 m spacing. */
function buildTrack(eles: number[], start: LatLon = { lat: 52.5, lon: 13.4 }): Track {
  const lat = [start.lat];
  const lon = [start.lon];
  let cur = start;
  for (let i = 1; i < eles.length; i++) {
    cur = offset(cur, 90, 10);
    lat.push(cur.lat);
    lon.push(cur.lon);
  }
  const dist = [0];
  for (let i = 1; i < lat.length; i++) {
    dist.push(
      dist[i - 1] +
        haversine({ lat: lat[i - 1], lon: lon[i - 1] }, { lat: lat[i], lon: lon[i] }),
    );
  }
  const data: TrackData = {
    lat,
    lon,
    ele: eles.slice(),
    t: dist.map((d) => d / 5),
    dist,
    speed: lat.map(() => 5),
  };
  return new Track(data);
}

/** Build a pose at distance `d` along the track, travelling due east (bearing 90). */
function poseAt(track: Track, d: number, bearing = 90): RidePose {
  const s = track.sampleByDist(d);
  return { lngLat: [s.lon, s.lat], elevation: s.ele, bearing, distance: d, time: s.time };
}

describe('chaseCamera — ground position', () => {
  it('places the camera CHASE_BEHIND metres behind the marker along the reverse bearing', () => {
    // 3 km of flat track so the trailing window never clamps.
    const track = buildTrack(new Array(301).fill(100));
    const pose = poseAt(track, 1500, 90); // heading east
    const cam = chaseCamera(track, pose);

    const marker: LatLon = { lat: pose.lngLat[1], lon: pose.lngLat[0] };
    const camPt: LatLon = { lat: cam.cameraLngLat[1], lon: cam.cameraLngLat[0] };
    expect(haversine(marker, camPt)).toBeCloseTo(CHASE_BEHIND, 0);
    // Camera is west of an east-heading marker → bearing marker→camera ≈ 270°.
    expect(bearingBetween(marker, camPt)).toBeCloseTo(270, 0);
  });
});

describe('chaseCamera — altitude clamp from GPX elevations', () => {
  it('uses marker elevation + CHASE_ABOVE over flat terrain (no clamp)', () => {
    const track = buildTrack(new Array(301).fill(100));
    const pose = poseAt(track, 1500);
    const cam = chaseCamera(track, pose);

    expect(cam.clamped).toBe(false);
    expect(cam.cameraAltitude).toBeCloseTo(100 + CHASE_ABOVE, 5);
    expect(cam.targetAltitude).toBeCloseTo(100, 5);
  });

  it('clamps up to the trailing-window peak + CHASE_CLEARANCE when a hill is behind', () => {
    // Flat at 100 m, but a 400 m spike right where the camera trails (≈130 m back).
    const eles = new Array(301).fill(100);
    const behindIdx = Math.round((1500 - CHASE_BEHIND) / 10); // ≈ index 137
    eles[behindIdx] = 400;
    const track = buildTrack(eles);
    const pose = poseAt(track, 1500);
    const cam = chaseCamera(track, pose);

    expect(cam.clamped).toBe(true);
    // marker(100)+above(55)=155 is below peak(400)+clearance(12)=412 → clamps to 412.
    expect(cam.cameraAltitude).toBeCloseTo(400 + CHASE_CLEARANCE, 5);
    expect(cam.cameraAltitude).toBeGreaterThan(pose.elevation + CHASE_ABOVE);
  });

  it('never lets the camera sit below the trailing terrain + clearance', () => {
    // A ridge that climbs behind the marker; the clamp must dominate every frame.
    const eles = Array.from({ length: 301 }, (_, i) => 100 + i); // 100..400 m
    const track = buildTrack(eles);
    for (let d = 300; d <= 2700; d += 300) {
      const cam = chaseCamera(track, poseAt(track, d));
      const trailingPeak = track.maxElevationNear(Math.max(0, d - CHASE_BEHIND), 60);
      expect(cam.cameraAltitude).toBeGreaterThanOrEqual(trailingPeak + CHASE_CLEARANCE - 1e-6);
    }
  });
});
