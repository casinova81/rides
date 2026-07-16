import { describe, it, expect } from 'vitest';
import { fmtKm, fmtElevation, fmtSpeedKmh, fmtDuration, fmtDate } from './format';

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
});
