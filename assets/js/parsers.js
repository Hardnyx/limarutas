// parsers.js
import { asLatLng, fetchJSON } from './utils.js';
import { COLOR_AN, COLOR_AS, COLOR_CORR, state } from './config.js';

/* =========================================
   Catálogo (filter only/exclude)
   ========================================= */
export function filterByCatalogFor(systemId, services, catalog){
  const upper = s => String(s).toUpperCase();
  const S = services;

  if (systemId === 'met') {
    const reg  = catalog?.metropolitano?.regulares || {};
    const exp  = catalog?.metropolitano?.expresos  || {};
    const onlyReg = Array.isArray(reg.only) ? new Set(reg.only.map(upper)) : null;
    const excReg  = Array.isArray(reg.exclude) ? new Set(reg.exclude.map(upper)) : new Set();
    const onlyExp = Array.isArray(exp.only) ? new Set(exp.only.map(upper)) : null;
    const excExp  = Array.isArray(exp.exclude) ? new Set(exp.exclude.map(upper)) : new Set();

    return S.filter(s => {
      const idU = upper(s.id);
      if (s.kind === 'regular') {
        if (excReg.has(idU)) return false;
        if (onlyReg) return onlyReg.has(idU);
        return true;
      }
      if (excExp.has(idU)) return false;
      if (onlyExp) return onlyExp.has(idU);
      return true;
    });
  }

  if (systemId === 'alim') {
    const al = catalog?.metropolitano?.alimentadores || {};
    if (al.mode === 'all') return S;
    const only = Array.isArray(al.only) ? new Set(al.only.map(upper)) : null;
    const exc  = Array.isArray(al.exclude) ? new Set(al.exclude.map(upper)) : new Set();
    return S.filter(s => {
      const idU = upper(s.id);
      if (exc.has(idU)) return false;
      if (only) return only.has(idU);
      return true;
    });
  }

  if (systemId === 'corr') {
    const corr = catalog?.corredores || {};
    if (corr.mode === 'all') return S;
    const only = Array.isArray(corr.only) ? new Set(corr.only.map(upper)) : null;
    const exc  = Array.isArray(corr.exclude) ? new Set(corr.exclude.map(upper)) : new Set();
    return S.filter(s => {
      const idU = upper(s.id);
      if (exc.has(idU)) return false;
      if (only) return only.has(idU);
      return true;
    });
  }

  if (systemId === 'metro') {
    const m = catalog?.metro || {};
    if (m.mode === 'all') return S;
    const only = Array.isArray(m.only) ? new Set(m.only.map(upper)) : null;
    const exc  = Array.isArray(m.exclude) ? new Set(m.exclude.map(upper)) : new Set();
    return S.filter(s => {
      const idU = upper(s.id);
      if (exc.has(idU)) return false;
      if (only) return only.has(idU);
      return true;
    });
  }

  if (systemId === 'wr') {
    // Usar catálogo.transporte con clave = código moderno (base)
    const tr = catalog?.transporte || {};
    // mode "all": sin filtro. mode "atu": igual que "only" hasta migración del CSV.
    if (tr.mode === 'all') return services;
    const only = Array.isArray(tr.only) ? new Set(tr.only.map(upper)) : null;
    const exc  = Array.isArray(tr.exclude) ? new Set(tr.exclude.map(upper)) : new Set();

    return services.filter(rt => {
      // rt viene de state.systems.wr.routesUi o similar
      // Si es par ida/vuelta, rt.id ya es el código base (1244)
      let base = rt && rt.id != null ? upper(rt.id) : '';
      // Si por alguna razón llega "1244-ida", recortar el sufijo
      const m = base.match(/^(.*?)-(IDA|VUELTA)$/);
      if (m) base = m[1];

      if (!base) return false;

      if (exc.has(base)) return false;
      if (only) return only.has(base);
      return true;
    });
  }

  return S;
}

/* =========================================
   Alimentadores
   ========================================= */
export const toSegments = (g) => {
  if (!g) return [];
  if (g.type === 'LineString')      return [g.coordinates.map(asLatLng)];
  if (g.type === 'MultiLineString') return g.coordinates.map(seg => seg.map(asLatLng));
  return [];
};

export function dirFromProps(p){
  const raw = (p.dir || p.direction || p.oneway || p.sentido || '').toString().toLowerCase();
  if (!raw) return null;
  if (/(^|[^a-z])n(orte)?($|[^a-z])/.test(raw) && !/(^|[^a-z])s(ur)?($|[^a-z])/.test(raw)) return 'norte';
  if (/(^|[^a-z])s(ur)?($|[^a-z])/.test(raw) && !/(^|[^a-z])n(orte)?($|[^a-z])/.test(raw)) return 'sur';
  return null;
}

export function classifySegmentsByNS(segments){
  const norte = [], sur = [], flat = [];
  segments.forEach(seg => {
    if (!Array.isArray(seg) || seg.length < 2) return;
    const a = seg[0], b = seg[seg.length-1];
    const dLat = b[0] - a[0];
    if (Math.abs(dLat) < 0.0005) flat.push(seg);
    else if (dLat > 0) norte.push(seg);
    else sur.push(seg);
  });
  return { norte, sur, flat };
}

export function buildAlimFromFC(json){
  const routes = new Map();
  const stops  = new Map();

  const ensure = (ref, props={}) => {
    if (!routes.has(ref)){
      const isN = String(ref).toUpperCase().startsWith('AN');
      routes.set(ref, {
        id: String(ref).toUpperCase(),
        name: props.name || props.label || '',
        zone: isN ? 'NORTE' : 'SUR',
        color: props.stroke || (isN ? COLOR_AN : COLOR_AS),
        geom: [],
        geom_norte: [],
        geom_sur: [],
        stops: []
      });
    } else {
      const s = routes.get(ref);
      if (!s.color && props.stroke) s.color = props.stroke;
      if (!s.name && (props.name || props.label)) s.name = props.name || props.label;
    }
    return routes.get(ref);
  };

  for (const f of (json?.features||[])){
    const g = f.geometry || {};
    const p = f.properties || {};
    const ref = p.ref_norm || p.ref || p.code || p.id;
    if (!ref) continue;

    if (g.type === 'LineString' || g.type === 'MultiLineString'){
      const svc = ensure(ref, p);
      const segs = toSegments(g);
      const dd = dirFromProps(p);
      if (dd === 'norte')      (svc.geom_norte = svc.geom_norte || []).push(...segs);
      else if (dd === 'sur')   (svc.geom_sur   = svc.geom_sur   || []).push(...segs);
      else                     svc.geom.push(...segs);
    }

    if (g.type === 'Point'){
      const [lat,lon] = asLatLng(g.coordinates || []);
      const svc = ensure(ref, p);
      const id = `alim:${ref}:${svc.stops.length}`;
      stops.set(id, { id, name: p.name || p.label || 'Paradero', lat, lon });
      svc.stops.push(id);
    }
  }

  for (const svc of routes.values()){
    if ((svc.geom_norte?.length||0)===0 && (svc.geom_sur?.length||0)===0 && (svc.geom?.length||0)>0){
      const {norte, sur, flat} = classifySegmentsByNS(svc.geom);
      svc.geom_norte = [...norte, ...flat];
      svc.geom_sur   = [...sur,   ...flat];
    }
  }

  return { services: Array.from(routes.values()), stops };
}

/* =========================================
   Corredores (GeoJSON oficial)
   ========================================= */
export function buildCorredoresFromFC(json){
  const routes = new Map();     // id -> {id,name,color,segments:[],stops:[]}
  const stops  = new Map();     // stopId -> {id,name,lat,lon}
  let noRef = 0;

  const ensure = (ref, props={}) => {
    const id = String(ref).toUpperCase();
    if (!routes.has(id)){
      routes.set(id, {
        id,
        name: props.name || props.label || '',
        color: props.stroke || props.color || '#10b981',
        segments: [],
        stops: []
      });
    } else {
      const s = routes.get(id);
      if (!s.color && (props.stroke || props.color)) s.color = props.stroke || props.color;
      if (!s.name && (props.name || props.label))    s.name  = props.name || props.label;
    }
    return routes.get(id);
  };

  for (const f of (json?.features || [])){
    const g = f.geometry || {};
    const p = f.properties || {};
    const ref = p.ref || p.route || p.id || p.code || p.codigo;
    if (!ref){ noRef++; continue; }

    const svc = ensure(ref, p);

    if (g.type === 'LineString' || g.type === 'MultiLineString'){
      const segs = toSegments(g);
      segs.forEach(seg => svc.segments.push(seg));
    }

    if (g.type === 'Point'){
      const [lat, lon] = asLatLng(g.coordinates || []);
      if (Number.isFinite(lat) && Number.isFinite(lon)){
        const sid = `corr:${String(ref).toUpperCase()}:${svc.stops.length}`;
        stops.set(sid, { id:sid, name: p.name || p.label || 'Paradero', lat, lon });
        svc.stops.push(sid);
      }
    }
  }

  return { services: [...routes.values()], stops, noRef };
}

/* =========================================
   Metro
   ========================================= */
export function buildMetroFromJSON(json){
  const lines = [];
  const stops = new Map();

  const pushStop = (lineId, st, idx) => {
    const id = `metro:${lineId}:${idx}`;
    stops.set(id, {
      id,
      name: st.name || st.label || `Estación ${idx+1}`,
      lat: st.lat,
      lon: st.lon
    });
    return id;
  };

  // Aquí asumimos que "segments" ya viene en [lat, lon]
  const pushLine = (LID, name, color, segmentsLatLon, stationObjs = []) => {
    const id = String(LID).toUpperCase();
    const svc = {
      id,
      name: name || `Línea ${id}`,
      color: color || '#0ea5e9',
      segments: [],
      stops: []
    };

    (segmentsLatLon || []).forEach(seg => {
      if (!Array.isArray(seg) || !seg.length) return;
      if (Array.isArray(seg[0]) && typeof seg[0][0] === 'number') {
        svc.segments.push(seg);
      }
    });

    (stationObjs || []).forEach((st, i) => {
      if (typeof st?.lat === 'number' && typeof st?.lon === 'number') {
        svc.stops.push(pushStop(id, st, i));
      }
    });

    lines.push(svc);
  };

  // Caso: FeatureCollection (metro.json / metro.geojson)
  if (json?.type === 'FeatureCollection') {
    const byId = new Map();

    for (const f of (json.features || [])) {
      const g = f.geometry || {};
      const p = f.properties || {};
      const ref = (p.ref || p.line || p.id || p.codigo || p.code || '')
        .toString()
        .toUpperCase();
      if (!ref) continue;

      if (!byId.has(ref)) {
        byId.set(ref, {
          name: p.name || p.label || `Línea ${ref}`,
          color: p.stroke || p.color || '#0ea5e9',
          segments: [],
          stations: []
        });
      }

      const acc = byId.get(ref);

      if (g.type === 'LineString' || g.type === 'MultiLineString') {
        const segsLL = toSegments(g);
        segsLL.forEach(seg => acc.segments.push(seg));
      } else if (g.type === 'Point') {
        const [lat, lon] = asLatLng(g.coordinates || []);
        acc.stations.push({
          name: p.name || p.label,
          lat,
          lon
        });
      }
    }

    for (const [id, v] of byId.entries()) {
      pushLine(id, v.name, v.color, v.segments, v.stations);
    }

  // Caso alternativo: estructura con json.lines
  } else if (Array.isArray(json?.lines)) {
    for (const L of json.lines) {
      const rawTrack =
        Array.isArray(L.track?.[0]?.[0]) ? L.track :
        Array.isArray(L.track)           ? [L.track] :
        [];

      const segsLL = rawTrack.map(seg => seg.map(asLatLng));
      pushLine(L.id, L.name, L.color, segsLL, L.stations);
    }
  }

  return { services: lines, stops };
}

/* =========================================
   Corredores desde rutas Wikiroutes (transporte.json)
   ========================================= */

// Construye un índice servicio -> metadata usando lista_corredores.json
function buildCorrIndexFromList(listaCorr) {
  const index = new Map();

  function addArray(arr, tipo, activa) {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || !item.servicio) continue;
      const raw = String(item.servicio).trim();
      if (!raw) continue;

      const firstChar = raw[0];
      const colorKey = COLOR_CORR[firstChar] ? firstChar : null;
      const color = colorKey ? COLOR_CORR[colorKey] : undefined;

      index.set(raw, {
        servicio: raw,
        origen: item.origen || '',
        destino: item.destino || '',
        tipo,      // 'principal' o 'alimentador'
        activa,    // true o false
        colorKey,
        color
      });
    }
  }

  addArray(listaCorr?.rutas_principales_activas,   'principal',    true);
  addArray(listaCorr?.rutas_alimentadoras_activas, 'alimentador',  true);
  addArray(listaCorr?.rutas_principales_inactivas, 'principal',    false);
  addArray(listaCorr?.rutas_alimentadoras_inactivas, 'alimentador', false);

  return index;
}

// Intenta emparejar una ruta Wikiroutes con la tabla de corredores
function findCorrMetaForRoute(rt, corrIndex) {
  const candidates = [];

  if (rt?.id != null)       candidates.push(String(rt.id).trim());
  if (rt?.code != null)     candidates.push(String(rt.code).trim());
  if (rt?.servicio != null) candidates.push(String(rt.servicio).trim());
  if (rt?.route_id != null) candidates.push(String(rt.route_id).trim());

  for (const key of candidates) {
    if (!key) continue;
    const meta = corrIndex.get(key);
    if (meta) return { key, meta };
  }
  return null;
}

/**
 * Construye la vista de corredores basados en rutas de transporte (Wikiroutes).
 *
 * routes: array de rutas de transporte.json (state.systems.wr.routes)
 *         donde cada ruta tiene al menos un campo que coincide con "servicio"
 *         en lista_corredores.json (id, code, servicio, route_id, etc.).
 *
 * listaCorr: objeto cargado desde config/lista_corredores.json
 *
 * Devuelve:
 * {
 *   services: [ ...rutas de corredor enriquecidas... ],
 *   groups: {
 *     principales_activas: [...],
 *     principales_inactivas: [...],
 *     alimentadoras_activas: [...],
 *     alimentadoras_inactivas: [...]
 *   }
 * }
 */
export function buildCorrFromWrRoutes(routes, listaCorr) {
  if (!Array.isArray(routes) || !listaCorr) {
    return {
      services: [],
      groups: {
        principales_activas: [],
        principales_inactivas: [],
        alimentadoras_activas: [],
        alimentadoras_inactivas: []
      }
    };
  }

  const corrIndex = buildCorrIndexFromList(listaCorr);
  const corrServices = [];

  for (const rt of routes) {
    const hit = findCorrMetaForRoute(rt, corrIndex);
    if (!hit) continue;

    const { meta } = hit;

    // Clonamos la ruta y añadimos metadata de corredor
    corrServices.push({
      ...rt,
      corrServicio: meta.servicio,
      corrOrigen: meta.origen,
      corrDestino: meta.destino,
      corrTipo: meta.tipo,       // 'principal'|'alimentador'
      corrActiva: meta.activa,   // true|false
      corrColor: meta.color || null,
      corrColorKey: meta.colorKey || null
    });
  }

  return {
    services: corrServices,
    groups: {
      principales_activas: corrServices.filter(
        s => s.corrTipo === 'principal' && s.corrActiva
      ),
      principales_inactivas: corrServices.filter(
        s => s.corrTipo === 'principal' && !s.corrActiva
      ),
      alimentadoras_activas: corrServices.filter(
        s => s.corrTipo === 'alimentador' && s.corrActiva
      ),
      alimentadoras_inactivas: corrServices.filter(
        s => s.corrTipo === 'alimentador' && !s.corrActiva
      )
    }
  };
}

/* =========================================
   Wikiroutes helpers
   ========================================= */

// Primera coord para inferir orden XY
function inspectFirstCoord(geojson) {
  let c = null;
  const walk = (g) => {
    if (!g) return;
    if (g.type === 'Point') c = g.coordinates;
    else if (g.type === 'LineString') c = g.coordinates?.[0];
    else if (g.type === 'MultiLineString') c = g.coordinates?.[0]?.[0];
    else if (g.type === 'Feature') walk(g.geometry);
    else if (g.type === 'FeatureCollection') walk(g.features?.[0]?.geometry);
  };
  walk(geojson);
  return Array.isArray(c) && c.length >= 2 ? c : null;
}

// Intercambia XY solo dentro de geometrías
function swapXYInGeometry(geom){
  if (!geom) return geom;
  const copy = JSON.parse(JSON.stringify(geom));

  const swapPair = (p) => Array.isArray(p) && p.length>=2 && typeof p[0]==='number' && typeof p[1]==='number'
    ? [p[1], p[0]] : p;

  const rec = (coords) => {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === 'number') return swapPair(coords);
    return coords.map(c => rec(c));
  };

  if (copy.type === 'Point') {
    copy.coordinates = swapPair(copy.coordinates);
  } else if (
    copy.type === 'LineString' || copy.type === 'MultiLineString' ||
    copy.type === 'Polygon'    || copy.type === 'MultiPolygon'
  ) {
    copy.coordinates = rec(copy.coordinates);
  }
  return copy;
}

function fixIfLatLon(geojson) {
  const c = inspectFirstCoord(geojson);
  if (!c) return geojson;
  // Lima: |lon| ~ 77, |lat| ~ 12. Si primer número parece lat, invertimos.
  const looksLatLon = Math.abs(c[0]) < Math.abs(c[1]);
  if (!looksLatLon) return geojson;

  const clone = JSON.parse(JSON.stringify(geojson));
  if (clone.type === 'FeatureCollection') {
    clone.features = (clone.features || []).map(f => {
      if (f && f.geometry) f.geometry = swapXYInGeometry(f.geometry);
      return f;
    });
  } else if (clone.type === 'Feature') {
    if (clone.geometry) clone.geometry = swapXYInGeometry(clone.geometry);
  } else if (clone.type && clone.coordinates) {
    return swapXYInGeometry(clone);
  }
  return clone;
}

// Construye un FC de líneas a partir de paraderos ordenados
function buildLineFCFromStops(stops){
  const groups = new Map();
  for (const s of stops){
    const k = (s.properties?.direction || '').toString();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const feats = [];
  for (const [dir, arr] of groups.entries()){
    const ordered = arr
      .map(f => ({ f, seq: Number(f.properties?.sequence ?? Infinity) }))
      .sort((a,b) => a.seq - b.seq)
      .map(x => x.f);
    const coords = ordered
      .map(f => f.geometry?.coordinates)
      .filter(p => Array.isArray(p) && p.length >= 2);
    if (coords.length >= 2) {
      feats.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { direction: dir || '' }
      });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

/* =========================================
   Capa Wikiroutes (por ruta)
   ========================================= */

// Normaliza trip: 1=ida, 2=vuelta
function normalizeWrTrip(trip){
  const n = Number(trip);
  return (n === 1 || n === 2) ? n : null;
}

function parseWrTripValue(v){
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return (v === 1 || v === 2) ? v : null;

  const s = String(v).toLowerCase().trim();
  if (!s) return null;

  if (s === '1') return 1;
  if (s === '2') return 2;

  if (s === 'ida' || s.includes('ida') || s === 'outbound' || s === 'forward') return 1;
  if (s === 'vuelta' || s.includes('vuelta') || s === 'return' || s === 'reverse' || s === 'back') return 2;

  if (s === 'ns' || s === 'north_south' || s === 'north-south') return 1;
  if (s === 'sn' || s === 'south_north' || s === 'south-north') return 2;

  return null;
}

function featureMatchesWrTrip(f, tripNum){
  const p = f?.properties || {};
  const candidates = [
    p.trip, p.trip_id,
    p.direction, p.direction_id,
    p.dir, p.sentido, p.way,
    p.shape, p.shape_id,
    p.route_dir
  ];

  for (const v of candidates){
    const t = parseWrTripValue(v);
    if (t !== null) return t === tripNum;
  }

  const s = `${p.id ?? ''} ${p.name ?? ''} ${p.title ?? ''}`.trim();
  const t = parseWrTripValue(s);
  if (t !== null) return t === tripNum;

  return false;
}

function pickMultiLineByTrip(geojson, tripNum){
  const pickCoords = (coords) => {
    if (!Array.isArray(coords)) return null;
    if (coords.length === 2 && (tripNum === 1 || tripNum === 2)) return coords[tripNum - 1];
    return null;
  };

  if (geojson?.type === 'Feature' && geojson.geometry?.type === 'MultiLineString'){
    const coords = pickCoords(geojson.geometry.coordinates);
    if (coords) return { ...geojson, geometry: { type:'LineString', coordinates: coords } };
  }

  if (geojson?.type === 'FeatureCollection' && Array.isArray(geojson.features) && geojson.features.length === 1){
    const f = geojson.features[0];
    if (f?.geometry?.type === 'MultiLineString'){
      const coords = pickCoords(f.geometry.coordinates);
      if (coords) {
        return { ...geojson, features: [{ ...f, geometry: { type:'LineString', coordinates: coords } }] };
      }
    }
  }

  if (geojson?.type === 'MultiLineString'){
    const coords = pickCoords(geojson.coordinates);
    if (coords) return { type:'LineString', coordinates: coords };
  }

  return geojson;
}

function filterGeoJSONByTrip(geojson, trip){
  const tripNum = normalizeWrTrip(trip);
  if (!tripNum || !geojson) return geojson;

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    const matched = geojson.features.filter(f => featureMatchesWrTrip(f, tripNum));
    if (matched.length) return { ...geojson, features: matched };
  }

  return pickMultiLineByTrip(geojson, tripNum);
}

export async function buildWikiroutesLayer(id, folderPath, opts = {}) {
  const color = opts.color || '#00008C';

  // Normalizar trip (1 = ida, 2 = vuelta) si viene configurado
  let trip = opts.trip;
  if (trip !== undefined && trip !== null) {
    const tNum = Number(trip);
    trip = (tNum === 1 || tNum === 2) ? tNum : null;
  } else {
    trip = null;
  }

  const tryJSON = async (relPath) =>
    fetchJSON(`${folderPath}/${relPath}`).catch(() => null);

  // 1) Trazado
  let lineRaw = null;

  if (trip) {
    // Preferir archivos específicos por viaje, si existen
    lineRaw = await tryJSON(`route_track_trip${trip}.geojson`);
  }

  if (!lineRaw) {
    // Fallback a trazado general
    lineRaw = await tryJSON('route_track.geojson');
  }
  if (!lineRaw) {
    lineRaw = await tryJSON('line_approx.geojson');
  }

  // 2) Paraderos
  let ptsRaw = null;

  if (trip) {
    // Preferir archivos de paraderos por viaje
    ptsRaw = await tryJSON(`stops_trip${trip}.geojson`);
  }

  if (!ptsRaw) {
    ptsRaw = await tryJSON('stops.geojson');
  }
  if (!ptsRaw) {
    ptsRaw = await tryJSON('stops_from_map.geojson');
  }

  if (!lineRaw && !ptsRaw) {
    throw new Error('No se encontraron archivos de trazado ni de paraderos en la carpeta Wikiroutes');
  }

  const line = lineRaw ? fixIfLatLon(lineRaw) : null;
  const pts  = ptsRaw  ? fixIfLatLon(ptsRaw)  : null;

  // Si no hay líneas, intenta construirlas a partir de los puntos
  let lineFC = line;
  if (!lineFC && pts?.type === 'FeatureCollection') {
    const onlyPoints = pts.features?.filter(f => f?.geometry?.type === 'Point') || [];
    if (onlyPoints.length >= 2) {
      lineFC = buildLineFCFromStops(onlyPoints);
    }
  }

  // Crear grupo de capas para esta ruta
  const group      = L.layerGroup();
  const stopsGroup = L.layerGroup();
  let bounds       = null;

  if (lineFC) {
    const style = f => ({
      color,
      weight: f?.properties?.weight || 5,
      opacity: f?.properties?.opacity ?? 0.9
    });

    const lineLyr = L.geoJSON(lineFC, { style });
    lineLyr.addTo(group);

    try {
      const b = lineLyr.getBounds?.();
      if (b) bounds = bounds ? bounds.extend(b) : b;
    } catch {}
  }

  if (pts && pts.type === 'FeatureCollection') {
    const stopStyle = {
      radius: 4,
      fillColor: color,
      color: '#000',
      weight: 1,
      opacity: 1,
      fillOpacity: 0.9
    };

    const stopLyr = L.geoJSON(pts, {
      pointToLayer: (_feat, latlng) => L.circleMarker(latlng, stopStyle)
    });
    stopLyr.addTo(stopsGroup);

    try {
      const b = stopLyr.getBounds?.();
      if (b) bounds = bounds ? bounds.extend(b) : b;
    } catch {}
  }

  // Registrar capas y bounds (no se agregan al mapa aquí)
  state.systems.wr.layers.set(id, group);
  state.systems.wr.stopLayers ||= new Map();
  state.systems.wr.stopLayers.set(id, stopsGroup);
  if (bounds) state.systems.wr.bounds.set(id, bounds);
}