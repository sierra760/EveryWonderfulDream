// Loading the atlas's static data files (built by scripts/build-data.mjs).

export interface Lld {
  m: string;
  t: string;
  r: string;
  s: number;
  type: string;
  sub: string;
}

export interface Tract {
  id: string;
  serial: string;
  office: string;
  doc: string;
  pat: string | null;
  name: string[] | null;
  /** the patentees exactly as BLM's index has them, e.g. "SEM RUTH" */
  indexed?: string[] | null;
  dateSource?: 'patent' | 'index' | null;
  date: string | null;
  year: number | null;
  yearEstimated: boolean;
  image: string | null;
  lld: Lld[];
  twp: string;
  twpLabel: string | null;
  sec: number | null;
  sub: string | null;
  approx: boolean;
  derived?: boolean;
  nominal: number | null;
  mapped: number | null;
  acres: number | null;
  c: [number, number];
  elev: number | null;
  place: string | null;
  g: number[][][][];
}

export interface Township {
  key: string;
  label: string;
  sections: Record<string, [number, number][]>;
  tracts: Tract[];
}

export interface Place {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  blurb: string;
  tracts: number;
  acres: number;
  bbox: [number, number, number, number] | null;
  medianYear: number | null;
  dots?: { w: number; h: number; p: number[] };
}

export interface Summary {
  generated: string;
  tracts: number;
  patented: number;
  acres: number;
  approximate: number;
  townships: number;
  sections: number;
  years: Record<string, number>;
  bbox: [number, number, number, number];
  places: Place[];
  townshipList: { key: string; label: string; tracts: number; bbox: [number, number, number, number] }[];
}

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const dataUrl = (path: string) => `${BASE}/data/${path}`;

const cache = new Map<string, Promise<unknown>>();

export function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(dataUrl(path)).then((r) => {
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}

export const getSummary = () => getJson<Summary>('summary.json');
export const getTownship = (key: string) => getJson<Township>(`twp/${key}.json`);

export async function findTract(id: string): Promise<{ township: Township; tract: Tract } | null> {
  const clean = id.trim().toUpperCase();
  const shard = clean.slice(-2).toLowerCase().replace(/[^a-z0-9]/g, '_');
  let map: Record<string, string>;
  try {
    map = await getJson<Record<string, string>>(`id/${shard}.json`);
  } catch {
    return null;
  }
  const key = map[clean];
  if (!key) return null;
  const township = await getTownship(key);
  const tract = township.tracts.find((t) => t.id === clean);
  return tract ? { township, tract } : null;
}

export function tractBounds(t: Pick<Tract, 'g'>): [number, number, number, number] {
  let b: [number, number, number, number] = [180, 90, -180, -90];
  for (const poly of t.g) for (const ring of poly) for (const [x, y] of ring) {
    b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  }
  return b;
}

export function tractFeature(t: Tract, extra: Record<string, unknown> = {}) {
  return {
    type: 'Feature' as const,
    properties: { id: t.id, y: t.year ?? 0, ...extra },
    geometry: { type: 'MultiPolygon' as const, coordinates: t.g },
  };
}
