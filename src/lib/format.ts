// The single formatting layer (issue 03). Stored values are SI (m, s, m/s);
// everything shown to the user passes through here. Locale is one constant:
// de-DE number/date formats (comma decimals, DD.MM.YYYY, 24-h) with English UI
// labels supplied by the markup. GPX times are UTC; dates/times render in Berlin.

export const LOCALE = 'de-DE';
export const TIME_ZONE = 'Europe/Berlin';

const nf = (min: number, max: number) =>
  new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max });

const oneDp = nf(1, 1);
const whole = nf(0, 0);

/** Distance in km with one decimal, e.g. `57,9 km`. */
export function fmtKm(meters: number): string {
  return `${oneDp.format(meters / 1000)} km`;
}

/** Elevation as whole metres (the formatter rounds), e.g. `1.241 m`. */
export function fmtElevation(meters: number): string {
  return `${whole.format(meters)} m`;
}

/** Speed converted from m/s to km/h with one decimal, e.g. `13,8 km/h`. */
export function fmtSpeedKmh(mps: number): string {
  return `${fmtKmhNumber(mps)} km/h`;
}

/** The bare km/h number with one decimal, e.g. `13,8` — for readouts that set the unit separately. */
export function fmtKmhNumber(mps: number): string {
  return oneDp.format(mps * 3.6);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Duration as `h:mm:ss`, dropping the hour field when it is zero (`m:ss`). */
export function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** A UTC ISO instant as its Berlin calendar date, e.g. `05.07.2026`. */
export function fmtDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** A UTC ISO instant as its 24-h Berlin wall-clock time, e.g. `12:00`. */
export function fmtTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** A gradient percentage with one comma decimal, e.g. `7,2 %` / `-4,2 %`. */
export function fmtGradient(pct: number): string {
  return `${oneDp.format(pct)} %`;
}

/**
 * Prefix an explicit `+` on a positive delta and `-` on a negative one, formatting
 * the *magnitude* through `fmtAbs` (so formatters that assume a non-negative input,
 * like fmtDuration, never see a negative). A delta whose magnitude rounds to the
 * same string as zero renders unsigned — never a stray `-0,0`.
 */
function signedMag(value: number, fmtAbs: (n: number) => string): string {
  const body = fmtAbs(Math.abs(value));
  if (body === fmtAbs(0)) return body;
  return value > 0 ? `+${body}` : `-${body}`;
}

/** A signed elevation delta in whole metres, e.g. `+12 m` / `-8 m` / `0 m`. */
export function fmtEleDelta(meters: number): string {
  return signedMag(meters, fmtElevation);
}

/** A signed distance delta in km, e.g. `+2,3 km` / `-1,0 km` / `0,0 km`. */
export function fmtDeltaKm(meters: number): string {
  return signedMag(meters, fmtKm);
}

/** A signed duration delta, e.g. `+1:23` / `-1:01:01` / `0:00`. */
export function fmtDeltaDuration(seconds: number): string {
  return signedMag(seconds, fmtDuration);
}

/** A signed speed delta in km/h, e.g. `+3,6 km/h` / `-3,6 km/h` / `0,0 km/h`. */
export function fmtDeltaSpeedKmh(mps: number): string {
  return signedMag(mps, fmtSpeedKmh);
}

/** Prettify a raw Komoot sport code (`e_bike`) into an English label (`E Bike`). */
export function fmtSport(sport: string): string {
  return sport
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
