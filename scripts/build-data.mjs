#!/usr/bin/env node
// Turn the raw BLM harvest (data/raw) into the static files the site reads
// (public/data). Run after scripts/harvest-blm.mjs.
//
//   public/data/summary.json            totals, per-place and per-township stats
//   public/data/tracts.geojson          every tract outline (slim properties)
//   public/data/lights.json             tract centroids for the low-zoom "lights" layer
//   public/data/classifications.geojson Small Tract classification areas
//   public/data/county.geojson          San Bernardino County outline
//   public/data/plss.geojson            section outlines for townships with tracts
//   public/data/twp/<key>.json          full records + section outlines, grouped by township
//   public/data/id/<nn>.json            tract id -> township key lookup shards
//   public/data/search.json             compact search index
//   public/data/names/<letter>.json     alphabetical index of patentees
//   public/data/name-stats.json         counts for the Names page

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import area from '@turf/area';
import centroid from '@turf/centroid';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { multiPolygon, point } from '@turf/helpers';
import {
  parseLld, townshipKey, townshipShort, subdivisionShort, nominalAcres, aliquotBox,
} from './lib/lld.mjs';
import { yearFromPatentNumber } from './lib/patent-dates.mjs';
import { formatPatentee, indexLabel } from './lib/names.mjs';
import { nameStats } from './lib/name-stats.mjs';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'public', 'data');
const SQM_PER_ACRE = 4046.8564224;

const OFFICES = {
  CALA: 'Los Angeles',
  CARI: 'Riverside',
  CAS: 'Sacramento',
  CACA: 'California',
  CAIN: 'Independence',
  CASF: 'San Francisco',
  CAEC: 'El Centro',
};

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const round = (n, d) => Number(n.toFixed(d));

function slug(serial) {
  return serial.trim().replace(/\s+/g, '-').toUpperCase();
}

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// ArcGIS rings -> GeoJSON MultiPolygon coordinates. Clockwise rings are
// exterior, counter-clockwise rings are holes of the preceding exterior.
function ringsToMultiPolygon(rings) {
  const signed = (r) => r.reduce((s, [x, y], i) => {
    const [x2, y2] = r[(i + 1) % r.length];
    return s + (x2 - x) * (y2 + y);
  }, 0);
  const polys = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    if (signed(ring) >= 0 || !polys.length) polys.push([ring]);
    else polys.at(-1).push(ring);
  }
  return polys;
}

// Douglas-Peucker, to strip the densified vertices from survey lines.
function simplify(ring, tol = 1.5e-5) {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  // a closed ring needs a second anchor: the vertex farthest from the first
  let far = 0, farD = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  keep[far] = 1;
  const stack = [[0, far], [far, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (ring[i][0] - ax) - dx * (ring[i][1] - ay)) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}

// Elevation from cached Terrarium tiles (see harvest-context.mjs).
const DEM_ZOOM = 12;
const demCache = new Map();
async function elevationAt(lon, lat) {
  const n = 2 ** DEM_ZOOM;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const key = `${DEM_ZOOM}-${x}-${y}`;
  if (!demCache.has(key)) {
    try {
      demCache.set(key, PNG.sync.read(await readFile(join(RAW, 'dem', `${key}.png`))));
    } catch {
      demCache.set(key, null);
    }
  }
  const png = demCache.get(key);
  if (!png) return null;
  const px = Math.min(png.width - 1, Math.floor((fx - x) * png.width));
  const py = Math.min(png.height - 1, Math.floor((fy - y) * png.height));
  const i = (py * png.width + px) * 4;
  return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
}

// ---------------------------------------------------------------- load

const county = await readJson(join(RAW, 'county.geojson'));
const countyFeature = county.features[0];
const places = await readJson(join(ROOT, 'data', 'places.json'));
const verified = await readJson(join(ROOT, 'data', 'patents-verified.json'));

// BLM's own patent index (FOIA, 1997, via Larry Vredenburgh): who and when.
// See scripts/import-foia-patents.py.
const indexByPatent = new Map();
const indexByCase = new Map();
try {
  for (const r of await readJson(join(ROOT, 'data', 'foia-small-tract.json'))) {
    const year = Number(r.t.slice(0, 4));
    const entry = { date: year >= 1938 && year <= 1995 ? r.t : null, names: r.n };
    for (const [map, key] of [[indexByPatent, r.d.trim()], [indexByCase, slug(r.c)]]) {
      const prior = map.get(key);
      if (prior) prior.names = [...new Set([...prior.names, ...entry.names])];
      else map.set(key, { ...entry, names: [...entry.names] });
    }
  }
} catch {
  console.warn('No patent index found (data/foia-small-tract.json): names and exact dates will be missing.');
}

// PLSS sections, keyed by township
const sectionsByTwp = new Map();
try {
  for (const f of await readdir(join(RAW, 'plss'))) {
    if (!f.endsWith('.json')) continue;
    const id = f.replace('.json', '');
    const lld = parseLld(`${id.slice(0, 2)} ${id.slice(2, 4)} ${id.slice(4, 9)} ${id.slice(9, 14)} 001`);
    if (!lld) continue;
    const secs = {};
    for (const ft of (await readJson(join(RAW, 'plss', f))).features) {
      if (ft.attributes.FRSTDIVTYP !== 'SN' || !ft.geometry?.rings?.length) continue;
      const no = Number(ft.attributes.FRSTDIVNO);
      const ring = simplify(ft.geometry.rings[0]).map(([x, y]) => [round(x, 6), round(y, 6)]);
      if (!secs[no] || ring.length > secs[no].length) secs[no] = ring;
    }
    sectionsByTwp.set(townshipKey(lld), { label: townshipShort(lld), secs });
  }
} catch {
  console.warn('No PLSS sections harvested yet (run scripts/harvest-context.mjs).');
}

const files = (await readdir(RAW)).filter((f) => /^cases-\d+\.json$/.test(f)).sort();
const features = [];
for (const f of files) features.push(...(await readJson(join(RAW, f))).features);
console.log(`Raw features: ${features.length}`);

// ---------------------------------------------------------------- group by case

const cases = new Map();
for (const f of features) {
  const a = f.attributes;
  const serial = (a.LEG_CSE_NR ?? a.CSE_NR ?? '').trim();
  if (!serial) continue;
  const rings = f.geometry?.rings ?? [];
  const key = `${a.CSE_TYPE_NR}|${serial}`;
  let c = cases.get(key);
  if (!c) {
    c = { serial, type: a.CSE_TYPE_NR, pat: null, lld: new Set(), polys: [], disp: a.CSE_DISP, dispDate: a.CSE_DISP_DT, recordAcres: a.RCRD_ACRS };
    cases.set(key, c);
  }
  if (a.PAT_NR && !c.pat) c.pat = a.PAT_NR.trim();
  for (const line of (a.CSE_META ?? '').split('|')) if (line.trim()) c.lld.add(line.trim());
  c.polys.push(...ringsToMultiPolygon(rings));
}

// ---------------------------------------------------------------- shape records

function nearestPlace(lon, lat) {
  let best = null;
  for (const p of places) {
    const d = haversineKm([lon, lat], [p.lon, p.lat]);
    if (d <= (p.radiusKm ?? 12) && (!best || d < best.d)) best = { id: p.id, d };
  }
  return best?.id ?? null;
}

const tracts = [];
const estimateCheck = [];
const classifications = [];
const skipped = { noGeometry: 0, outsideCounty: 0 };

for (const c of cases.values()) {
  if (!c.polys.length) { skipped.noGeometry++; continue; }
  const geom = multiPolygon(c.polys);
  const [lon, lat] = centroid(geom).geometry.coordinates;
  if (!booleanPointInPolygon(point([lon, lat]), countyFeature)) { skipped.outsideCounty++; continue; }
  const acres = area(geom) / SQM_PER_ACRE;
  const elev = c.type === '273000' ? await elevationAt(lon, lat) : null;

  if (c.type !== '273000') {
    classifications.push({
      type: 'Feature',
      properties: {
        serial: c.serial.replace(/\s+/g, ' '),
        status: c.disp,
        acres: round(acres, 1),
        date: c.dispDate ? new Date(c.dispDate).toISOString().slice(0, 10) : null,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: c.polys.map((p) => p.map((r) => r.map(([x, y]) => [round(x, 5), round(y, 5)]))),
      },
    });
    continue;
  }

  const llds = [...c.lld].map(parseLld).filter(Boolean);
  const first = llds[0] ?? null;
  const prefix = c.serial.split(/\s+/)[0];
  const doc = c.serial.split(/\s+/).slice(1).join(' ');
  const best = nearestPlace(lon, lat);
  // Where BLM's description stops at the section ("ALL") the tract's own
  // outline is unknown: the service returns the whole square mile instead.
  // The same happens for some numbered lots, which come back as 600+ acres.
  const approx = !llds.length || acres > 45 ||
    llds.some((l) => !['A', 'B', 'L'].includes(l.type) || l.sub === 'ALL' || !l.sub);
  const nominal = !approx && llds.every((l) => nominalAcres(l) != null)
    ? llds.reduce((s, l) => s + nominalAcres(l), 0)
    : null;
  const id = slug(c.serial);
  const v = c.pat ? verified[c.pat] : null;
  const ix = (c.pat && indexByPatent.get(c.pat)) || indexByCase.get(id) || null;
  const date = v?.date ?? ix?.date ?? null;
  const estimate = yearFromPatentNumber(c.pat);
  const year = date ? Number(date.slice(0, 4)) : estimate;
  if (ix?.date && estimate && /^\d{7}$/.test(c.pat ?? '')) estimateCheck.push(estimate - Number(ix.date.slice(0, 4)));

  tracts.push({
    id,
    serial: c.serial.replace(/\s+/g, ' '),
    office: OFFICES[prefix] ?? prefix,
    doc: doc.replace(/^0(?=\d{6})/, ''),
    pat: c.pat,
    name: v?.names ?? (ix ? ix.names.map(formatPatentee) : null),
    indexed: ix?.names ?? null,
    date,
    dateSource: v?.date ? 'patent' : ix?.date ? 'index' : null,
    year,
    yearEstimated: Boolean(year && !date),
    image: v?.image ?? null,
    lld: llds,
    twp: first ? townshipKey(first) : 'unknown',
    twpLabel: first ? townshipShort(first) : null,
    sec: first?.s ?? null,
    sub: llds.map(subdivisionShort).join('; ') || null,
    approx,
    nominal,
    mapped: approx ? null : round(acres, 2),
    acres: approx ? null : (nominal ?? round(acres, 2)),
    c: [round(lon, 6), round(lat, 6)],
    elev: elev == null ? null : Math.round(elev),
    place: best,
    derived: false,
    g: c.polys,
  });
}

// ---------------------------------------------------------------- derive missing outlines
//
// A few hundred cases carry a perfectly good aliquot description (say
// W2NESWNE) under a survey-type code BLM's geocoder does not resolve, so the
// service hands back the whole section. For those the outline can be worked
// out here: find the section's four corners and subdivide between them.

function sectionCorners(ring) {
  const k = Math.cos((ring[0][1] * Math.PI) / 180);
  const pick = (f) => ring.reduce((a, p) => (f(p) > f(a) ? p : a));
  return {
    nw: pick(([x, y]) => -x * k + y),
    ne: pick(([x, y]) => x * k + y),
    se: pick(([x, y]) => x * k - y),
    sw: pick(([x, y]) => -x * k - y),
  };
}

function aliquotRing(corners, box) {
  const at = (u, v) => [0, 1].map((i) =>
    corners.sw[i] * (1 - u) * (1 - v) + corners.se[i] * u * (1 - v) +
    corners.nw[i] * (1 - u) * v + corners.ne[i] * u * v);
  const { u0, u1, v0, v1 } = box;
  return [at(u0, v1), at(u1, v1), at(u1, v0), at(u0, v0), at(u0, v1)].map(([x, y]) => [round(x, 6), round(y, 6)]);
}

function derivedPolys(t) {
  const secs = sectionsByTwp.get(t.twp)?.secs;
  if (!secs || !t.lld.length) return null;
  const polys = [];
  for (const l of t.lld) {
    const ring = secs[l.s];
    const box = l.type === 'L' ? null : aliquotBox(l.sub);
    if (!ring || !box) return null;
    polys.push([aliquotRing(sectionCorners(ring), box)]);
  }
  return polys;
}

// Check the method against tracts BLM did map: how far apart are the centres?
{
  const errors = [];
  for (const t of tracts) {
    if (t.approx || t.lld.length !== 1 || t.nominal !== 5) continue;
    const polys = derivedPolys(t);
    if (!polys) continue;
    const [x, y] = centroid(multiPolygon(polys)).geometry.coordinates;
    errors.push(haversineKm([x, y], t.c) * 1000);
  }
  errors.sort((a, b) => a - b);
  const q = (f) => errors[Math.floor(errors.length * f)]?.toFixed(1);
  console.log(`Derived-outline check on ${errors.length} mapped five-acre tracts: median ${q(0.5)} m, 90% within ${q(0.9)} m, 99% within ${q(0.99)} m`);
}

if (estimateCheck.length) {
  const exact = estimateCheck.filter((d) => d === 0).length;
  const near = estimateCheck.filter((d) => Math.abs(d) <= 1).length;
  console.log(`Year estimated from patent number vs. indexed date, ${estimateCheck.length} patents: ` +
    `${((exact / estimateCheck.length) * 100).toFixed(1)}% same year, ${((near / estimateCheck.length) * 100).toFixed(1)}% within one`);
}

let derivedCount = 0;
for (const t of tracts) {
  if (!t.approx) continue;
  const polys = derivedPolys(t);
  if (!polys) continue;
  const [lon, lat] = centroid(multiPolygon(polys)).geometry.coordinates;
  const nominal = t.lld.reduce((s, l) => s + nominalAcres(l), 0);
  const elev = await elevationAt(lon, lat);
  Object.assign(t, {
    g: polys,
    c: [round(lon, 6), round(lat, 6)],
    approx: false,
    derived: true,
    nominal,
    mapped: null,
    acres: nominal,
    elev: elev == null ? t.elev : Math.round(elev),
    place: nearestPlace(lon, lat),
  });
  derivedCount++;
}
console.log(`Outlines derived from legal descriptions: ${derivedCount}`);

tracts.sort((a, b) => a.id.localeCompare(b.id));
const dupes = tracts.length - new Set(tracts.map((t) => t.id)).size;
if (dupes) throw new Error(`${dupes} duplicate tract ids`);
console.log(`Tracts in county: ${tracts.length}  classifications: ${classifications.length}  skipped: ${JSON.stringify(skipped)}`);

// ---------------------------------------------------------------- write

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'twp'), { recursive: true });
await mkdir(join(OUT, 'id'), { recursive: true });
const write = (rel, data) => writeFile(join(OUT, rel), JSON.stringify(data));

// township files
const byTwp = new Map();
for (const t of tracts) {
  if (!byTwp.has(t.twp)) byTwp.set(t.twp, []);
  byTwp.get(t.twp).push(t);
}
const twpKeys = [...byTwp.keys()].sort();
const twpIndex = new Map(twpKeys.map((k, i) => [k, i]));
for (const [key, list] of byTwp) {
  await write(`twp/${key}.json`, {
    key,
    label: list[0].twpLabel,
    sections: sectionsByTwp.get(key)?.secs ?? {},
    tracts: list,
  });
}

// survey grid overlay: only sections of townships that hold tracts
const plssFeatures = [];
for (const key of twpKeys) {
  const t = sectionsByTwp.get(key);
  if (!t) continue;
  for (const [no, ring] of Object.entries(t.secs)) {
    plssFeatures.push({
      type: 'Feature',
      properties: { t: t.label, s: Number(no), n: byTwp.get(key).filter((x) => x.sec === Number(no)).length },
      geometry: { type: 'Polygon', coordinates: [ring.map(([x, y]) => [round(x, 5), round(y, 5)])] },
    });
  }
}
await write('plss.geojson', { type: 'FeatureCollection', features: plssFeatures });

// id -> township shards (keyed by the last two characters of the id)
const shards = new Map();
for (const t of tracts) {
  const s = t.id.slice(-2).toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (!shards.has(s)) shards.set(s, {});
  shards.get(s)[t.id] = t.twp;
}
for (const [s, map] of shards) await write(`id/${s}.json`, map);

// overview geometry
const placeIndex = new Map(places.map((p, i) => [p.id, i]));
await write('tracts.geojson', {
  type: 'FeatureCollection',
  features: tracts.filter((t) => !t.approx).map((t, i) => ({
    type: 'Feature',
    id: i,
    properties: {
      id: t.id,
      t: twpIndex.get(t.twp),
      p: t.place ? placeIndex.get(t.place) : -1,
      y: t.year ?? 0,
      ...(t.name ? { n: t.name.join(' & ') } : {}),
    },
    geometry: {
      type: 'MultiPolygon',
      coordinates: t.g.map((p) => p.map((r) => r.map(([x, y]) => [round(x, 5), round(y, 5)]))),
    },
  })),
});
await write('lights.json', tracts.filter((t) => !t.approx).flatMap((t) => [round(t.c[0], 4), round(t.c[1], 4), t.year ?? 0]));
await write('classifications.geojson', { type: 'FeatureCollection', features: classifications });
await write('county.geojson', {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { name: 'San Bernardino County' }, geometry: countyFeature.geometry }],
});

// search index (parallel arrays keep it small)
await write('search.json', {
  twp: twpKeys,
  id: tracts.map((t) => t.id),
  pat: tracts.map((t) => t.pat ?? ''),
  t: tracts.map((t) => twpIndex.get(t.twp)),
  s: tracts.map((t) => t.sec ?? 0),
  sub: tracts.map((t) => t.sub ?? ''),
  name: tracts.map((t) => (t.name ?? []).join('; ')),
  c: tracts.flatMap((t) => [round(t.c[0], 4), round(t.c[1], 4)]),
});

// alphabetical index of patentees, one file per initial
await mkdir(join(OUT, 'names'), { recursive: true });
const byLetter = new Map();
for (const t of tracts) {
  for (const raw of t.indexed ?? []) {
    const label = indexLabel(raw);
    const letter = /^[A-Z]/.test(label) ? label[0] : '#';
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push([label, t.id, t.year ?? 0, t.place ? placeIndex.get(t.place) : -1]);
  }
}
const collator = new Intl.Collator('en', { sensitivity: 'base' });
const nameLetters = {};
for (const [letter, list] of byLetter) {
  list.sort((a, b) => collator.compare(a[0], b[0]) || a[2] - b[2]);
  nameLetters[letter] = list.length;
  await write(`names/${letter === '#' ? 'other' : letter}.json`, list);
}

// what the names add up to (Names page)
const givenLists = await readJson(join(ROOT, 'data', 'given-names.json'));
const themed = await readJson(join(ROOT, 'data', 'themed-surnames.json'));
const stats = nameStats(tracts, { women: givenLists.women, men: givenLists.men, themed });
if (stats.given.unlisted.length) {
  console.log(`Common first names on neither list in data/given-names.json: ${stats.given.unlisted.map((g) => g.join(' ')).join(', ')}`);
}
delete stats.given.unlisted;
await write('name-stats.json', stats);

// summary
const bboxOf = (list) => list.reduce(
  (b, t) => [Math.min(b[0], t.c[0]), Math.min(b[1], t.c[1]), Math.max(b[2], t.c[0]), Math.max(b[3], t.c[1])],
  [180, 90, -180, -90],
).map((n) => round(n, 4));
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

// A tiny dot-map of a place's tracts, for thumbnails: integer coordinates in a
// box `w` wide and `h` tall (north up), one dot per occupied cell.
function dotMap(list, size = 96) {
  if (!list.length) return null;
  const [x0, y0, x1, y1] = bboxOf(list);
  const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
  const spanX = Math.max((x1 - x0) * k, 1e-6);
  const spanY = Math.max(y1 - y0, 1e-6);
  const scale = size / Math.max(spanX, spanY);
  const w = Math.max(1, Math.round(spanX * scale));
  const h = Math.max(1, Math.round(spanY * scale));
  const cells = new Set();
  for (const t of list) {
    const x = Math.round((t.c[0] - x0) * k * scale);
    const y = Math.round((y1 - t.c[1]) * scale);
    cells.add(y * 1000 + x);
  }
  return { w, h, p: [...cells].sort((a, b) => a - b) };
}

const years = {};
for (const t of tracts) if (t.year) years[t.year] = (years[t.year] ?? 0) + 1;

const summary = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'BLM Mineral & Land Records System (MLRS), Land Tenure Case layer, product SMALL TRACT',
  tracts: tracts.length,
  patented: tracts.filter((t) => t.pat).length,
  acres: Math.round(sum(tracts, (t) => t.acres ?? 0)),
  approximate: tracts.filter((t) => t.approx).length,
  derived: tracts.filter((t) => t.derived).length,
  townships: twpKeys.length,
  sections: new Set(tracts.map((t) => `${t.twp}/${t.sec}`)).size,
  classifications: classifications.length,
  classifiedAcres: Math.round(sum(classifications, (c) => c.properties.acres)),
  withNames: tracts.filter((t) => t.name).length,
  withDates: tracts.filter((t) => t.date).length,
  patentees: tracts.reduce((n, t) => n + (t.name?.length ?? 0), 0),
  nameLetters: Object.fromEntries(Object.entries(nameLetters).sort()),
  withImages: tracts.filter((t) => t.image).length,
  yearsEstimated: tracts.filter((t) => t.yearEstimated).length,
  years,
  bbox: bboxOf(tracts),
  elevation: (() => {
    const e = tracts.filter((t) => t.elev != null).sort((a, b) => a.elev - b.elev);
    if (!e.length) return null;
    return { lowest: { id: e[0].id, m: e[0].elev }, highest: { id: e.at(-1).id, m: e.at(-1).elev }, median: e[Math.floor(e.length / 2)].elev };
  })(),
  sizes: {
    under2: tracts.filter((t) => t.acres != null && t.acres < 2).length,
    twoAndHalf: tracts.filter((t) => t.acres >= 2 && t.acres < 3.5).length,
    five: tracts.filter((t) => t.acres >= 3.5 && t.acres < 7.5).length,
    larger: tracts.filter((t) => t.acres >= 7.5).length,
  },
  places: places.map((p) => {
    const list = tracts.filter((t) => t.place === p.id);
    const ys = list.map((t) => t.year).filter(Boolean).sort((a, b) => a - b);
    return {
      ...p,
      dots: dotMap(list),
      tracts: list.length,
      acres: Math.round(sum(list, (t) => t.acres ?? 0)),
      bbox: list.length ? bboxOf(list) : null,
      medianYear: ys.length ? ys[Math.floor(ys.length / 2)] : null,
    };
  }),
  unplaced: tracts.filter((t) => !t.place).length,
  townshipList: twpKeys.map((k) => {
    const list = byTwp.get(k);
    return { key: k, label: list[0].twpLabel, tracts: list.length, bbox: bboxOf(list) };
  }),
};
await write('summary.json', summary);

console.log(JSON.stringify({ ...summary, years: undefined, places: summary.places.map((p) => `${p.name}: ${p.tracts}`), townshipList: undefined }, null, 1));
