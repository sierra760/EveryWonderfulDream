#!/usr/bin/env node
// Harvest every Small Tract Act case that BLM has mapped in California from
// the public National Land Status GIS service (clipped to San Bernardino
// County later, in build-data.mjs).
//
// Source: BLM Mineral & Land Records System (MLRS) land-tenure cases, geocoded
// by BLM against the Public Land Survey System.
//   https://nlsdbpubgis.blm.gov/arcgis/rest/services/Land_Tenure/Land_Tenure_Case/MapServer/0
//
// The service is public and paginated (max 2000 records per request). We ask
// for modest pages, one request at a time, and cache every page on disk so a
// re-run only fetches what is missing.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');

const CASE_LAYER =
  'https://nlsdbpubgis.blm.gov/arcgis/rest/services/Land_Tenure/Land_Tenure_Case/MapServer/0/query';
const COUNTY_LAYER =
  'https://gis.blm.gov/arcgis/rest/services/admin_boundaries/BOC_Natl_CountyBoundaries/MapServer';

const PAGE = 1000;
const FIELDS = [
  'OBJECTID', 'CSE_NR', 'LEG_CSE_NR', 'CSE_TYPE_NR', 'BLM_PROD', 'CSE_DISP',
  'CSE_DISP_DT', 'CSE_DISP_ACTION', 'PAT_NR', 'CSE_META', 'RCRD_ACRS',
  'REC_TYPE_CSE_GRP', 'CSE_NAME', 'QLTY',
].join(',');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

async function getJson(url, params, tries = 6) {
  const body = new URLSearchParams(params);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'User-Agent': 'every-wonderful-dream-atlas/0.1 (historical research)' },
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`service error ${JSON.stringify(json.error)}`);
      return json;
    } catch (err) {
      if (attempt >= tries) throw err;
      const wait = 4000 * attempt;
      console.warn(`  retry ${attempt} after ${err.message} (waiting ${wait / 1000}s)`);
      await sleep(wait);
    }
  }
}

async function harvestCases() {
  // Attribute-only query with keyset pagination on OBJECTID. (A spatial filter
  // over the whole county times out on the server; clipping to the county
  // polygon happens locally in build-data.mjs instead.)
  const where = "BLM_PROD='SMALL TRACT' AND GEO_STATE='CA'";
  const { count } = await getJson(CASE_LAYER, { where, returnCountOnly: 'true', f: 'json' });
  console.log(`California Small Tract case features: ${count}`);
  await writeFile(join(RAW, 'count.json'), JSON.stringify({ count, fetched: new Date().toISOString() }));

  let last = -1;
  for (let page = 0; ; page++) {
    const file = join(RAW, `cases-${String(page).padStart(3, '0')}.json`);
    let json;
    if (await exists(file)) {
      json = JSON.parse(await readFile(file, 'utf8'));
    } else {
      const t0 = Date.now();
      json = await getJson(CASE_LAYER, {
        where: `${where} AND OBJECTID > ${last}`,
        outFields: FIELDS,
        outSR: '4326',
        geometryPrecision: '6',
        orderByFields: 'OBJECTID',
        resultRecordCount: String(PAGE),
        f: 'json',
      });
      await writeFile(file, JSON.stringify(json));
      console.log(`  page ${page}: ${json.features.length} features in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await sleep(750);
    }
    if (!json.features.length) break;
    last = json.features.at(-1).attributes.OBJECTID;
    if (json.features.length < PAGE && !json.exceededTransferLimit) break;
  }
}

async function harvestCounty() {
  const file = join(RAW, 'county.geojson');
  if (await exists(file)) return;
  const meta = await getJson(COUNTY_LAYER, { f: 'json' });
  const layer = meta.layers.find((l) => /count/i.test(l.name)) ?? meta.layers[0];
  const info = await getJson(`${COUNTY_LAYER}/${layer.id}`, { f: 'json' });
  const names = info.fields.map((f) => f.name);
  const nameField = names.find((n) => /^(NAME|COUNTY_NAME|CNTY_NAME|NAMELSAD)$/i.test(n)) ?? names.find((n) => /name/i.test(n));
  const stateField = names.find((n) => /^(STATE_ABBR|STUSPS|STATE|ST_ABBR|STATE_NAME|STATEFP)$/i.test(n));
  console.log(`County layer ${layer.id} "${layer.name}" fields: ${names.join(', ')}`);
  const json = await getJson(`${COUNTY_LAYER}/${layer.id}/query`, {
    where: `UPPER(${nameField}) LIKE 'SAN BERNARDINO%'`,
    outFields: '*',
    outSR: '4326',
    geometryPrecision: '5',
    f: 'geojson',
  });
  const hits = json.features.filter((f) => {
    const s = stateField ? String(f.properties[stateField]) : '';
    return !stateField || /^(CA|California|06)$/i.test(s);
  });
  if (!hits.length) throw new Error('San Bernardino County boundary not found');
  await writeFile(file, JSON.stringify({ type: 'FeatureCollection', features: hits }));
  console.log(`County boundary saved (${hits.length} feature)`);
}

await mkdir(RAW, { recursive: true });
await harvestCounty();
await harvestCases();
console.log('Harvest complete.');
