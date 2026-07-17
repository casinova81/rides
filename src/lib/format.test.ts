import { describe, it, expect } from 'vitest';
import {
  fmtKm,
  fmtElevation,
  fmtSpeedKmh,
  fmtDuration,
  fmtDate,
  fmtTime,
  fmtGradient,
  fmtSport,
  fmtEleDelta,
  fmtDeltaKm,
  fmtDeltaDuration,
  fmtDeltaSpeedKmh,
} from './format';

// The single formatting layer (issue 03): stored values are SI; display is de-DE
// (comma decimals, DD.MM.YYYY) with times in Europe/Berlin. English labels live
// in the markup, not here.

describe('format — de-DE display of SI values', () => {
  it('renders distance in km with a comma decimal', () => {
    expect(fmtKm(57900)).toBe('57,9 km');
    expect(fmtKm(1000)).toBe('1,0 km');
    expect(fmtKm(0)).toBe('0,0 km');
  });

  it('renders elevation as whole metres', () => {
    expect(fmtElevation(97)).toBe('97 m');
    expect(fmtElevation(1240.6)).toBe('1.241 m'); // de-DE thousands separator is a dot
  });

  it('converts m/s to km/h with one decimal', () => {
    expect(fmtSpeedKmh(3.84)).toBe('13,8 km/h');
    expect(fmtSpeedKmh(0)).toBe('0,0 km/h');
  });

  it('formats durations as h:mm:ss, dropping the hour when zero', () => {
    expect(fmtDuration(12327)).toBe('3:25:27');
    expect(fmtDuration(152)).toBe('2:32');
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(3661)).toBe('1:01:01');
  });

  it('formats a UTC ISO instant as a Berlin calendar date', () => {
    expect(fmtDate('2026-07-05T10:00:57Z')).toBe('05.07.2026');
    // 00:30 UTC on the 5th is still 02:30 the 5th in Berlin (summer, +2)
    expect(fmtDate('2026-07-05T00:30:00Z')).toBe('05.07.2026');
    // 23:30 UTC on the 4th is 01:30 the 5th in Berlin — rolls to the next day
    expect(fmtDate('2026-07-04T23:30:00Z')).toBe('05.07.2026');
  });

  it('formats a UTC ISO instant as a 24-h Berlin wall-clock time', () => {
    expect(fmtTime('2026-07-05T10:00:57Z')).toBe('12:00'); // +2 in summer
    expect(fmtTime('2026-01-05T10:00:00Z')).toBe('11:00'); // +1 in winter
    expect(fmtTime('2026-07-04T23:30:00Z')).toBe('01:30'); // rolls past midnight
  });

  it('renders a gradient percentage with a comma decimal and sign', () => {
    expect(fmtGradient(7.2)).toBe('7,2 %');
    expect(fmtGradient(-4.15)).toBe('-4,2 %');
    expect(fmtGradient(0)).toBe('0,0 %');
  });

  it('renders a signed elevation delta in whole metres', () => {
    expect(fmtEleDelta(12)).toBe('+12 m');
    expect(fmtEleDelta(-8)).toBe('-8 m');
    expect(fmtEleDelta(0)).toBe('0 m');
    expect(fmtEleDelta(-0.4)).toBe('0 m'); // rounds to -0 — must not render as "-0 m"
  });

  it('renders signed deltas with an explicit + on gains (compare Δ column)', () => {
    // Δ = ride 2 − ride 1: positive gets a +, negative keeps its -, zero stays bare.
    expect(fmtDeltaKm(2300)).toBe('+2,3 km');
    expect(fmtDeltaKm(-1000)).toBe('-1,0 km');
    expect(fmtDeltaKm(0)).toBe('0,0 km');

    // fmtDuration itself assumes a non-negative time; the delta formatter must
    // format the magnitude and carry the sign, never feed a negative through.
    expect(fmtDeltaDuration(83)).toBe('+1:23');
    expect(fmtDeltaDuration(-83)).toBe('-1:23');
    expect(fmtDeltaDuration(3661)).toBe('+1:01:01');
    expect(fmtDeltaDuration(0)).toBe('0:00');

    expect(fmtDeltaSpeedKmh(1)).toBe('+3,6 km/h');
    expect(fmtDeltaSpeedKmh(-1)).toBe('-3,6 km/h');
    expect(fmtDeltaSpeedKmh(0)).toBe('0,0 km/h');

    // A delta whose magnitude rounds below the display precision reads as an
    // unsigned zero, never "-0,0 km".
    expect(fmtDeltaKm(-40)).toBe('0,0 km');
  });

  it('prettifies a raw Komoot sport code into an English label', () => {
    expect(fmtSport('e_bike')).toBe('E Bike');
    expect(fmtSport('cycling')).toBe('Cycling');
    expect(fmtSport('')).toBe('');
  });
});
