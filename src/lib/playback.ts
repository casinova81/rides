import type { Track } from './track';
import type { RidePose } from './types';

// The engine-agnostic playback core (issue 09 / ticket 4b). Owns the clock
// (virtual time, speed steps, play/pause, seek) and pose smoothing, emitting one
// absolute `RidePose` per animation frame. It never touches a map: the MapView
// adapter consumes the pose and places the camera exactly, so smoothing is locked
// ride-feel, not engine-feel. `updateFrame` is absolute across the seam — the
// core resets its smoothing on seek so the pose itself jumps cleanly.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Playback speed multipliers, in toggle order (issue 07). */
export const SPEED_STEPS = [10, 50, 200, 500] as const;

export interface PlaybackOptions {
  /** Position smoothing time constant, seconds (issue 07 default 0.6). */
  positionTau?: number;
  /** Bearing smoothing time constant, seconds (issue 07 default 1.2). */
  bearingTau?: number;
  /** Look-ahead along the track for the heading, metres (issue 07 default 25). */
  lookahead?: number;
}

interface LonLat {
  lon: number;
  lat: number;
}

interface Vec {
  x: number;
  y: number;
}

export class PlaybackCore {
  private readonly track: Track;
  private readonly positionTau: number;
  private readonly bearingTau: number;
  private readonly lookahead: number;

  private vt = 0; // virtual (ride) time, seconds
  private _speed: number = SPEED_STEPS[1]; // 50× default (issue 07 prototype)
  private _playing = false;

  // Smoothing state; null means "reset — snap on the next frame" (issue 09 seek).
  private smooth: LonLat | null = null;
  private smoothEle = 0;
  private bearVec: Vec | null = null;

  constructor(track: Track, opts: PlaybackOptions = {}) {
    this.track = track;
    this.positionTau = opts.positionTau ?? 0.6;
    this.bearingTau = opts.bearingTau ?? 1.2;
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
    this.smooth = null;
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

    // Position: exponential relaxation toward the raw sample (τ = positionTau).
    const k = this.positionTau > 0 ? 1 - Math.exp(-dt / this.positionTau) : 1;
    if (this.smooth === null) {
      this.smooth = { lon: raw.lon, lat: raw.lat };
      this.smoothEle = raw.ele;
    } else {
      this.smooth.lon += (raw.lon - this.smooth.lon) * k;
      this.smooth.lat += (raw.lat - this.smooth.lat) * k;
      this.smoothEle += (raw.ele - this.smoothEle) * k;
    }

    // Bearing: circular (vector) smoothing of a look-ahead heading — averaging the
    // direction vectors, so 350°→10° relaxes through north, not through the south.
    const rawBear = this.track.bearingAt(raw.dist, this.lookahead);
    const bk = this.bearingTau > 0 ? 1 - Math.exp(-dt / this.bearingTau) : 1;
    const target: Vec = { x: Math.sin(rawBear * D2R), y: Math.cos(rawBear * D2R) };
    if (this.bearVec === null) {
      this.bearVec = target;
    } else {
      this.bearVec.x += (target.x - this.bearVec.x) * bk;
      this.bearVec.y += (target.y - this.bearVec.y) * bk;
    }
    const bearing = (Math.atan2(this.bearVec.x, this.bearVec.y) * R2D + 360) % 360;

    return {
      lngLat: [this.smooth.lon, this.smooth.lat],
      elevation: this.smoothEle,
      bearing,
      distance: raw.dist,
      time: this.vt,
    };
  }
}
