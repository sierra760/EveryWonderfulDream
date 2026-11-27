#!/usr/bin/env node
// Harvest the context the tract pages need, for the townships that actually
// contain Small Tract cases:
//
//   1. PLSS section outlines from BLM's national cadastral layer (CadNSDI)
//        https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2
//   2. Elevation tiles (Terrarium-encoded PNG, zoom 12) from the public
//      AWS Terrain Tiles open dataset, to read each tract's elevation.
//
// Run after harvest-blm.mjs. Everything is cached under data/raw.

import { mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const SECTION_LAYER =
  'https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2/query';
const DEM_ZOOM = 12;
const demUrl = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_ZOOM}/${x}/${y}.png`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);
const UA = { 'User-Agent': 'every-wonderful-dream-atlas/0.1 (historical research)' };

async function retry(fn, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= tries) throw err;
      console.warn(`  retry ${attempt}: ${err.message}`);
      await sleep(3000 * attempt);
    }
  }
}

// County bounding box, read from the harvested boundary.
const county = JSON.parse(await readFile(join(RAW, 'county.geojson'), 'utf8'));
let [minX, minY, maxX, maxY] = [180, 90, -180, -90];
(function walk(c) {
  if (typeof c[0] === 'number') {
    minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
    minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
  } else c.forEach(walk);
})(county.features[0].geometry.coordinates);

// Collect township ids and DEM tiles from the case harvest.
const plssIds = new Set();
const tiles = new Set();
const files = (await readdir(RAW)).filter((f) => /^cases-\d+\.json$/.test(f)).sort();
for (const f of files) {
  const { features } = JSON.parse(await readFile(join(RAW, f), 'utf8'));
  for (const ft of features) {
    const a = ft.attributes;
    const ring = ft.geometry?.rings?.[0];
    if (a.CSE_TYPE_NR !== '273000' || !ring) continue;
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    for (const line of (a.CSE_META ?? '').split('|')) {
      const t = line.trim().split(/\s+/);
      if (t.length >= 4) plssIds.add(`${t[0]}${t[1]}${t[2]}${t[3]}0`);
    }
    const n = 2 ** DEM_ZOOM;
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    tiles.add(`${x}/${y}`);
  }
}
console.log(`Townships: ${plssIds.size}   elevation tiles: ${tiles.size}`);

// 1. sections
await mkdir(join(RAW, 'plss'), { recursive: true });
for (const id of [...plssIds].sort()) {
  const file = join(RAW, 'plss', `${id}.json`);
  if (await exists(file)) continue;
  const json = await retry(async () => {
    const res = await fetch(SECTION_LAYER, {
      method: 'POST',
      headers: UA,
      body: new URLSearchParams({
        where: `PLSSID='${id}'`,
        outFields: 'PLSSID,FRSTDIVID,FRSTDIVNO,FRSTDIVTYP',
        outSR: '4326',
        geometryPrecision: '6',
        f: 'json',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j;
  });
  await writeFile(file, JSON.stringify(json));
  console.log(`  ${id}: ${json.features.length} sections`);
  await sleep(300);
}

// 2. elevation tiles
await mkdir(join(RAW, 'dem'), { recursive: true });
let fetched = 0;
for (const key of [...tiles].sort()) {
  const [x, y] = key.split('/');
  const file = join(RAW, 'dem', `${DEM_ZOOM}-${x}-${y}.png`);
  if (await exists(file)) continue;
  const buf = await retry(async () => {
    const res = await fetch(demUrl(x, y), { headers: UA, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  await writeFile(file, buf);
  fetched++;
  await sleep(60);
}
console.log(`Elevation tiles fetched: ${fetched}`);
console.log('Context harvest complete.');
