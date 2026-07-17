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
  return `${oneDp.format(mps * 3.6)} km/h`;
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

/** A signed elevation delta in whole metres, e.g. `+12 m` / `-8 m` / `0 m`. */
export function fmtEleDelta(meters: number): string {
  const r = Math.round(meters) || 0; // `|| 0` folds a rounded -0 back to 0 → "0 m", not "-0 m"
  return `${r > 0 ? '+' : ''}${whole.format(r)} m`;
}

/** Prettify a raw Komoot sport code (`e_bike`) into an English label (`E Bike`). */
export function fmtSport(sport: string): string {
  return sport
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
