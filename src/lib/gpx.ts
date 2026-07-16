// Minimal GPX parser for Komoot exports (issue 02: source is always Komoot).
// Regex-based on purpose: no DOMParser dependency, so the whole derivation core
// runs identically in the browser (upload), the Worker, and node tests.

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number; // m
  time: number; // seconds since epoch, unrounded (Komoot stamps ms precision)
}

export interface ParsedGpx {
  name: string; // raw Komoot <trk><name>
  sport: string; // raw Komoot <trk><type>
  points: TrackPoint[];
}

const TRK_RE = /<trk\b[^>]*>([\s\S]*?)<\/trk>/;
const NAME_RE = /<name>([\s\S]*?)<\/name>/;
const TYPE_RE = /<type>([\s\S]*?)<\/type>/;
const PT_RE = /<trkpt\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
const ELE_RE = /<ele>([^<]+)<\/ele>/;
const TIME_RE = /<time>([^<]+)<\/time>/;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Parse GPX text into name, sport, and ordered trackpoints. Throws on anything
 * that isn't a usable Komoot track (the upload path reports this as a per-file
 * failure). Timestamps stay unrounded — point speeds must derive from them
 * (issue 03: rounding first produced absurd max speeds).
 */
export function parseGpx(text: string): ParsedGpx {
  const trkMatch = TRK_RE.exec(text);
  if (!trkMatch) throw new Error('no <trk> element');
  const trk = trkMatch[1];

  // name/type live before the first <trkseg>; slice it off so trackpoint
  // sub-elements can never be mistaken for the track name/type.
  const head = trk.split('<trkseg')[0];
  const name = decodeEntities(NAME_RE.exec(head)?.[1] ?? '') || 'Ride';
  const sport = decodeEntities(TYPE_RE.exec(head)?.[1] ?? '');

  const points: TrackPoint[] = [];
  let m: RegExpExecArray | null;
  PT_RE.lastIndex = 0;
  while ((m = PT_RE.exec(trk))) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    const inner = m[3];
    const timeStr = TIME_RE.exec(inner)?.[1];
    if (!timeStr) throw new Error('trackpoint missing <time>');
    const time = new Date(timeStr).getTime() / 1000;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(time)) {
      throw new Error('trackpoint has invalid lat/lon/time');
    }
    const ele = Number(ELE_RE.exec(inner)?.[1] ?? 0);
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : 0, time });
  }

  if (points.length < 2) throw new Error('track has fewer than 2 points');
  return { name, sport, points };
}
