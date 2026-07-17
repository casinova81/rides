import type { Track } from './track';
import type { RidePose } from './types';

// The engine-agnostic playback core (issue 09 / ticket 4b). Owns the clock
// (virtual time, speed steps, play/pause, seek) and pose smoothing, emitting one
// absolute `RidePose` per animation frame. It never touches a map: the MapView
// adapter consumes the pose and places the camera exactly, so smoothing is locked
// ride-feel, not engine-feel. `updateFrame` is absolute across the seam — the
// core resets its smoothing on seek so the pose itself jumps cleanly.
//
// Position smoothing runs in arc-length space (a distance along the track, not
// lon/lat): the smoothed distance relaxes toward the clock's raw distance, and the
// pose is the track sampled *at* that distance. So the pose is always exactly on
// the polyline — the marker rides the line and never cuts corners — while speed
// transients (seeks, speed-step changes, GPS timing jitter) are still filtered
// by τ, which is what keeps the camera motion smooth.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Playback speed multipliers, in toggle order (issue 07). */
export const SPEED_STEPS = [10, 50, 200, 500] as const;

export interface PlaybackOptions {
  /** Position smoothing time constant, seconds (issue 07 default 0.6). */
  positionTau?: number;
  /**
   * Bearing smoothing length constant, metres (default 12). The heading relaxes
   * per metre of track travelled — not per real second — so the arrow turns in
   * step with the corners at every playback multiplier instead of lagging by a
   * fixed wall-clock delay that spans whole blocks at 200×.
   */
  bearingLength?: number;
  /** Look-ahead along the track for the heading, metres (issue 07 default 25). */
  lookahead?: number;
}

interface Vec {
  x: number;
  y: number;
}

export class PlaybackCore {
  private readonly track: Track;
  private readonly positionTau: number;
  private readonly bearingLength: number;
  private readonly lookahead: number;

  private vt = 0; // virtual (ride) time, seconds
  private _speed: number = SPEED_STEPS[1]; // 50× default (issue 07 prototype)
  private _playing = false;

  // Smoothing state; null means "reset — snap on the next frame" (issue 09 seek).
  private smoothDist: number | null = null;
  private bearVec: Vec | null = null;

  constructor(track: Track, opts: PlaybackOptions = {}) {
    this.track = track;
    this.positionTau = opts.positionTau ?? 0.6;
    this.bearingLength = opts.bearingLength ?? 12;
    this.lookahead = opts.lookahead ?? 25;
  }

  get playing(): boolean {
    return this._playing;
  }

  get time(): number {
    return this.vt;
  }

  get speed(): number {
    return this._speed;
  }

  get duration(): number {
    return this.track.duration;
  }

  /** Fraction complete, 0..1. */
  get progress(): number {
    return this.duration > 0 ? this.vt / this.duration : 0;
  }

  play(): void {
    // Replaying from the very end restarts, so play always makes progress.
    if (this.vt >= this.duration) this.seek(0);
    this._playing = true;
  }

  pause(): void {
    this._playing = false;
  }

  toggle(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this._speed = speed;
  }

  /** Jump the clock to `t` seconds (clamped) and reset smoothing so the pose jumps cleanly. */
  seek(t: number): void {
    this.vt = Math.max(0, Math.min(this.duration, t));
    this.smoothDist = null;
    this.bearVec = null;
  }

  /**
   * Advance by `dt` real seconds and return the smoothed absolute pose. Advances
   * the clock only while playing (auto-pausing at the end), but always relaxes the
   * smoothing toward the current raw sample so a paused marker settles in place.
   */
  frame(dt: number): RidePose {
    if (this._playing) {
      this.vt += dt * this._speed;
      if (this.vt >= this.duration) {
        this.vt = this.duration;
        this._playing = false;
      }
    }

    const raw = this.track.sampleByTime(this.vt);

    // Position: exponential relaxation of the distance along the track toward the
    // clock's raw distance (τ = positionTau), then sample the track *at* the
    // smoothed distance — the pose stays exactly on the polyline.
    const k = this.positionTau > 0 ? 1 - Math.exp(-dt / this.positionTau) : 1;
    const prevDist = this.smoothDist;
    if (this.smoothDist === null) {
      this.smoothDist = raw.dist;
    } else {
      this.smoothDist += (raw.dist - this.smoothDist) * k;
    }
    const s = this.track.sampleByDist(this.smoothDist);

    // Bearing: circular (vector) smoothing of a look-ahead heading — averaging the
    // direction vectors, so 350°→10° relaxes through north, not through the south.
    // Relaxation is per metre travelled (bearingLength), not per second: the arrow
    // turns with the corners at any playback multiplier — a real-time constant
    // would leave it pointing blocks behind at 200×.
    const rawBear = this.track.bearingAt(this.smoothDist, this.lookahead);
    const travelled = prevDist === null ? 0 : Math.abs(this.smoothDist - prevDist);
    const bk = this.bearingLength > 0 ? 1 - Math.exp(-travelled / this.bearingLength) : 1;
    const target: Vec = { x: Math.sin(rawBear * D2R), y: Math.cos(rawBear * D2R) };
    if (this.bearVec === null) {
      this.bearVec = target;
    } else {
      this.bearVec.x += (target.x - this.bearVec.x) * bk;
      this.bearVec.y += (target.y - this.bearVec.y) * bk;
    }
    const bearing = (Math.atan2(this.bearVec.x, this.bearVec.y) * R2D + 360) % 360;

    return {
      lngLat: [s.lon, s.lat],
      elevation: s.ele,
      bearing,
      distance: this.smoothDist,
      time: this.vt,
    };
  }
}
