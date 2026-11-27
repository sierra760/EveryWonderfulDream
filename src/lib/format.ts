// Turning records into words.
import type { Lld, Tract } from './data';
// @ts-ignore plain ESM shared with the build scripts
import { subdivisionLong, subdivisionShort, townshipLong, townshipShort } from '../../scripts/lib/lld.mjs';

export { subdivisionLong, subdivisionShort, townshipLong, townshipShort };

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n: number) => nf.format(n);

export function tractTitle(t: Tract): string {
  if (t.name?.length) return t.name.join(' & ');
  return `${t.office} ${t.doc}`;
}

export function serialLabel(t: Pick<Tract, 'office' | 'doc'>): string {
  return `${t.office} ${t.doc}`;
}

/** "CALA-0060931" -> "Los Angeles 060931" without loading the record. */
export function labelFromId(id: string): string {
  const offices: Record<string, string> = { CALA: 'Los Angeles', CARI: 'Riverside', CAS: 'Sacramento', CACA: 'California' };
  const [prefix, ...rest] = id.split('-');
  const doc = rest.join(' ').replace(/^0(?=\d{6})/, '');
  return `${offices[prefix] ?? prefix} ${doc}`;
}

export function acresLabel(t: Tract): string {
  if (t.acres == null) return 'Not mapped';
  const n = Number.isInteger(t.acres) ? String(t.acres) : t.acres.toFixed(2).replace(/\.?0+$/, '');
  return `${n} acre${t.acres === 1 ? '' : 's'}`;
}

export function yearLabel(t: Tract): string {
  if (t.date) {
    return new Date(`${t.date}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  if (t.year) return t.yearEstimated ? `c. ${t.year}` : String(t.year);
  return 'Unknown';
}

export function legalShort(l: Lld): string {
  return `${subdivisionShort(l)}, Sec. ${l.s}, ${townshipShort(l)}`;
}

export function legalLong(l: Lld): string {
  const sub = subdivisionLong(l);
  const head = sub === 'all' ? 'All of' : `${sub[0].toUpperCase()}${sub.slice(1)} of`;
  return `${head} Section ${l.s}, ${townshipLong(l)}`;
}

export function patentNumberLabel(pat: string | null): string {
  if (!pat) return 'None recorded';
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(pat);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : pat;
}

/** A search on BLM's GLO Records site that lands on this patent. */
export function gloUrl(t: Pick<Tract, 'pat' | 'doc'>): string {
  const q = t.pat && /^\d{7}$/.test(t.pat) ? `SER-${t.pat}` : t.pat ?? t.doc;
  const inner = `/search?q=${encodeURIComponent(q)}&page=1&pageSize=25`;
  return `https://glorecords.blm.gov/s/advanced-search?searchTerm=${encodeURIComponent(inner)}`;
}

export function feet(m: number): string {
  return `${fmt(Math.round(m * 3.28084))} ft`;
}

export function dms(lat: number, lon: number): string {
  const f = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = ((a - d) * 60 - m) * 60;
    return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${v >= 0 ? pos : neg}`;
  };
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}
