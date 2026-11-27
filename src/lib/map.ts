// One map vocabulary for the whole atlas: public-domain USGS imagery draped
// over open terrain, with the tracts drawn as warm outlines — cabin lights
// seen from a long way off.
//
// No API keys anywhere: imagery and topo come from USGS The National Map,
// elevation from the AWS Terrain Tiles open dataset (Mapzen), and label
// glyphs from the Protomaps basemap assets.

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { YEAR_STOPS } from './year-colors';

export { maplibregl };

export const GLOW = '#ffd68c';
export const HOT = '#fff6e0';
export const SELECT = '#7fe3ee';

const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services';
const NAIP =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage' +
  '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&f=image';
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';

export const FONT = ['Noto Sans Medium'];
export const FONT_ITALIC = ['Noto Sans Italic'];

export type Mood = 'dusk' | 'day';

const SKY: Record<Mood, Record<string, unknown>> = {
  dusk: {
    'sky-color': '#253d34',
    'horizon-color': '#e8c185',
    'fog-color': '#b6a074',
    'sky-horizon-blend': 0.75,
    'horizon-fog-blend': 0.8,
    'fog-ground-blend': 0.35,
    'atmosphere-blend': 0.7,
  },
  day: {
    'sky-color': '#7fa9c9',
    'horizon-color': '#f4dfc4',
    'fog-color': '#ead8bf',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.25,
    'atmosphere-blend': 0.5,
  },
};

const IMAGERY_PAINT: Record<Mood, Record<string, unknown>> = {
  dusk: { 'raster-saturation': -0.3, 'raster-brightness-max': 0.7, 'raster-contrast': 0.12, 'raster-fade-duration': 250 },
  day: { 'raster-saturation': -0.12, 'raster-brightness-max': 0.88, 'raster-contrast': 0.06, 'raster-fade-duration': 250 },
};

export function baseStyle(mood: Mood): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      imagery: {
        type: 'raster',
        tiles: [`${USGS}/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 16,
        attribution: 'Imagery &amp; topo: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>',
      },
      naip: {
        type: 'raster',
        tiles: [NAIP],
        tileSize: 256,
        minzoom: 16,
        maxzoom: 18,
        attribution: 'USDA NAIP',
      },
      topo: {
        type: 'raster',
        tiles: [`${USGS}/USGSTopo/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 16,
      },
      dem: {
        type: 'raster-dem',
        tiles: [TERRAIN],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 13,
        attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / AWS Terrain Tiles</a>',
      },
      hills: {
        type: 'raster-dem',
        tiles: [TERRAIN],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 13,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1e2b24' } },
      { id: 'imagery', type: 'raster', source: 'imagery', paint: IMAGERY_PAINT[mood] as never },
      {
        id: 'naip',
        type: 'raster',
        source: 'naip',
        minzoom: 16,
        paint: { ...(IMAGERY_PAINT[mood] as object), 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 16, 0, 16.4, 1] } as never,
      },
      { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.92 } },
      {
        id: 'hills',
        type: 'hillshade',
        source: 'hills',
        paint: {
          'hillshade-exaggeration': mood === 'dusk' ? 0.42 : 0.22,
          'hillshade-shadow-color': '#1a1030',
          'hillshade-highlight-color': '#ffe3b5',
          'hillshade-accent-color': '#3a2540',
          'hillshade-illumination-direction': 285,
        },
      },
    ],
    sky: SKY[mood] as never,
  };
}

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export interface MapOptions {
  container: HTMLElement;
  mood?: Mood;
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
  interactive?: boolean;
  terrain?: boolean;
  hash?: boolean;
  exaggeration?: number;
}

export function createMap(o: MapOptions): maplibregl.Map | null {
  if (!hasWebGL()) {
    if (o.interactive === false) return null;
    const fb = document.createElement('div');
    fb.className = 'map-fallback';
    fb.textContent = 'The 3D map couldn’t open in this browser.';
    o.container.append(fb);
    return null;
  }
  const map = new maplibregl.Map({
    container: o.container,
    style: baseStyle(o.mood ?? 'day'),
    center: o.center,
    zoom: o.zoom,
    pitch: o.pitch ?? 0,
    bearing: o.bearing ?? 0,
    maxPitch: 78,
    minZoom: 5.5,
    maxZoom: 18.4,
    hash: o.hash ?? false,
    interactive: o.interactive ?? true,
    attributionControl: false,
    maxBounds: [[-121.5, 31.6], [-111.5, 37.6]],
  });
  if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map;
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  // start with the attribution folded away behind its (i) button
  map.once('load', () => {
    const attrib = o.container.querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.remove('maplibregl-compact-show');
    attrib?.removeAttribute('open');
  });
  if (o.terrain !== false) {
    map.once('style.load', () => {
      try {
        map.setTerrain({ source: 'dem', exaggeration: o.exaggeration ?? 1.35 });
      } catch (err) {
        console.warn('terrain unavailable', err);
      }
    });
  }
  return map;
}

// ---------------------------------------------------------------- tract layers

const yearColor: maplibregl.ExpressionSpecification = [
  'case',
  ['==', ['coalesce', ['get', 'y'], 0], 0],
  '#b9b2a6',
  ['interpolate', ['linear'], ['get', 'y'], ...YEAR_STOPS.flat()],
] as never;

export function tractColor(byYear: boolean): maplibregl.ExpressionSpecification | string {
  return byYear ? yearColor : GLOW;
}

/**
 * Adds the tract outline layers for a GeoJSON source of tract polygons.
 * Feature-state `hover` and `selected` are honoured.
 */
export function addTractLayers(map: maplibregl.Map, source: string, prefix = 'tract', opts: { minzoom?: number } = {}) {
  const minzoom = opts.minzoom ?? 9.5;
  const state = (name: string) => ['boolean', ['feature-state', name], false] as never;
  map.addLayer({
    id: `${prefix}-fill`,
    type: 'fill',
    source,
    minzoom,
    paint: {
      'fill-color': ['case', state('selected'), SELECT, GLOW] as never,
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, ['case', state('selected'), 0.34, state('hover'), 0.3, 0.02],
        13, ['case', state('selected'), 0.34, state('hover'), 0.3, 0.07],
        16, ['case', state('selected'), 0.34, state('hover'), 0.3, 0.1],
      ] as never,
    },
  });
  map.addLayer({
    id: `${prefix}-glow`,
    type: 'line',
    source,
    minzoom: Math.max(minzoom, 12),
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': GLOW,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 9],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 8],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.12, 15, 0.3],
    },
  });
  map.addLayer({
    id: `${prefix}-line`,
    type: 'line',
    source,
    minzoom,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': ['case', state('selected'), SELECT, state('hover'), HOT, GLOW] as never,
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.35,
        13, ['case', state('selected'), 2.2, 0.9],
        16, ['case', state('selected'), 3.4, 1.7],
      ] as never,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0.45, 12, 0.85, 15, 0.95],
    },
  });
}

export function setTractColor(map: maplibregl.Map, prefix: string, byYear: boolean) {
  const state = (name: string) => ['boolean', ['feature-state', name], false];
  const c = tractColor(byYear);
  map.setPaintProperty(`${prefix}-line`, 'line-color', ['case', state('selected'), SELECT, state('hover'), HOT, c] as never);
  map.setPaintProperty(`${prefix}-glow`, 'line-color', c as never);
  map.setPaintProperty(`${prefix}-fill`, 'fill-color', ['case', state('selected'), SELECT, c] as never);
  if (map.getLayer('lights')) map.setPaintProperty('lights', 'circle-color', c as never);
}

/** Low-zoom view: every tract as a point of light. `flat` = [lon, lat, year, ...]. */
export function addLights(map: maplibregl.Map, flat: number[], maxzoom = 12.5) {
  const features = [];
  for (let i = 0; i < flat.length; i += 3) {
    features.push({
      type: 'Feature' as const,
      properties: { y: flat[i + 2] },
      geometry: { type: 'Point' as const, coordinates: [flat[i], flat[i + 1]] },
    });
  }
  map.addSource('lights', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({
    id: 'lights-halo',
    type: 'circle',
    source: 'lights',
    maxzoom,
    paint: {
      'circle-color': '#ffb65c',
      'circle-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 6, 1.4, 9, 3, 12, 7],
      'circle-blur': 1,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.12, 10, 0.1, maxzoom - 0.5, 0.06, maxzoom, 0],
      'circle-pitch-alignment': 'map',
    },
  });
  map.addLayer({
    id: 'lights',
    type: 'circle',
    source: 'lights',
    maxzoom,
    paint: {
      'circle-color': GLOW,
      'circle-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 6, 0.55, 9, 0.9, 11, 1.5, 12.5, 2.2],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.75, 11, 0.9, maxzoom - 0.6, 0.7, maxzoom, 0],
      'circle-pitch-alignment': 'map',
    },
  });
}

/** Survey grid: section lines and numbers, township labels. */
export interface PlssCollection {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: { s: number; t: string }; geometry: { type: 'Polygon'; coordinates: number[][][] } }[];
}

export function addPlssLayers(map: maplibregl.Map, grid: PlssCollection, before?: string) {
  map.addSource('plss', { type: 'geojson', data: grid as never });
  // one label per section, at the middle of its outline
  map.addSource('plss-labels', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: grid.features.map((f) => {
        const ring = f.geometry.coordinates[0];
        const xs = ring.map((p) => p[0]);
        const ys = ring.map((p) => p[1]);
        return {
          type: 'Feature' as const,
          properties: f.properties,
          geometry: {
            type: 'Point' as const,
            coordinates: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2],
          },
        };
      }),
    },
  });
  map.addLayer({
    id: 'plss-line',
    type: 'line',
    source: 'plss',
    minzoom: 10.5,
    paint: {
      'line-color': '#fff3da',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0.14, 13, 0.4],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10.5, 0.4, 15, 1.2],
      'line-dasharray': [5, 3],
    },
  }, before);
  map.addLayer({
    id: 'plss-label',
    type: 'symbol',
    source: 'plss-labels',
    minzoom: 11.8,
    layout: {
      'text-field': ['concat', 'SEC ', ['to-string', ['get', 's']], '\n', ['get', 't']],
      'text-font': FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], 11.8, 9, 15, 13],
      'text-letter-spacing': 0.14,
      'text-line-height': 1.35,
      'text-max-width': 20,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#fff3da',
      'text-opacity': 0.78,
      'text-halo-color': 'rgba(16,14,23,0.8)',
      'text-halo-width': 1.4,
    },
  }, before);
}

export interface LabelPlace { name: string; lon: number; lat: number; tracts: number }

export function addPlaceLabels(map: maplibregl.Map, places: LabelPlace[]) {
  map.addSource('places', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: places.filter((p) => p.tracts > 0).map((p) => ({
        type: 'Feature' as const,
        properties: { name: p.name.replace(' & ', ' &\n'), n: p.tracts },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      })),
    },
  });
  map.addLayer({
    id: 'place-label',
    type: 'symbol',
    source: 'places',
    maxzoom: 13.2,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': FONT_ITALIC,
      'text-size': ['interpolate', ['linear'], ['zoom'], 7, ['case', ['>', ['get', 'n'], 1500], 12, 0], 9.5, ['case', ['>', ['get', 'n'], 500], 14, 0], 10.5, ['case', ['>', ['get', 'n'], 100], 15, 12], 12, 18],
      'text-letter-spacing': 0.04,
      'text-line-height': 1.1,
      'symbol-sort-key': ['-', 0, ['get', 'n']],
      'text-padding': 6,
    },
    paint: {
      'text-color': '#fff6e3',
      'text-halo-color': 'rgba(16,14,23,0.82)',
      'text-halo-width': 1.6,
      'text-halo-blur': 0.5,
    },
  });
}

export function setBasemap(map: maplibregl.Map, which: 'imagery' | 'topo') {
  const topo = which === 'topo';
  map.setLayoutProperty('topo', 'visibility', topo ? 'visible' : 'none');
  map.setLayoutProperty('imagery', 'visibility', topo ? 'none' : 'visible');
  map.setLayoutProperty('naip', 'visibility', topo ? 'none' : 'visible');
}

/** Slow orbit around the current center; stops for good on first user input. */
export function orbit(map: maplibregl.Map, degPerSecond = 2.2) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = !reduce;
  let last = performance.now();
  let raf = 0;
  const step = (now: number) => {
    if (!running) return;
    const dt = Math.min(100, now - last) / 1000;
    last = now;
    if (!document.hidden) map.setBearing(map.getBearing() + degPerSecond * dt);
    raf = requestAnimationFrame(step);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const start = () => {
    if (running || reduce) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(step);
  };
  for (const ev of ['mousedown', 'touchstart', 'wheel', 'keydown'] as const) {
    map.getCanvas().addEventListener(ev, stop, { passive: true });
  }
  if (running) raf = requestAnimationFrame(step);
  return { stop, start, get running() { return running; } };
}
