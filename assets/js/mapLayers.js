// mapLayers.js
// Mapa base y capas de Metropolitano, Alimentadores, Corredores y Metro.
// Re-exporta la API de Wikiroutes y del encuadre para que el resto de
// módulos siga importando todo desde aquí.
import { state, getDirFor, CARTO_API_KEY } from './config.js';
import { $$, uniqueOrder } from './utils.js';
import { setOverStop } from './stopHover.js';
import { ensureCustomPanes, getLinePane, getStopPane } from './mapPanes.js';
import { fitTo, currentFitBatch, addBoundsToBatch } from './mapFit.js';
import { corrColorForSvc, forceStroke } from './mapColors.js';
import { syncOneWrStopsVisibility } from './mapLayers.wr.js';

export { fitTo, centerOn, beginFitBatch, endFitBatch } from './mapFit.js';
export { setWikiroutesVisible, countVisibleWrRoutes } from './mapLayers.wr.js';

const MIN_ZOOM = 10;
const MAX_ZOOM = 19;

const LIMA_BOUNDS = L.latLngBounds(
  L.latLng(-12.55, -77.25),
  L.latLng(-11.70, -76.70)
);

// Caja amplia para limitar el arrastre
const MAX_BOUNDS = L.latLngBounds(
  L.latLng(-12.58, -77.55),
  L.latLng(-11.65, -76.50)
);

// Mostrar rectángulo de debug si lo necesitas
const SHOW_BOUNDS_RECT = false;
let maxBoundsRect = null;

// Sin key (desarrollo local) CARTO sirve los tiles con marca de agua
const CARTO_KEY_QS = CARTO_API_KEY && !CARTO_API_KEY.startsWith('__')
  ? `?key=${encodeURIComponent(CARTO_API_KEY)}`
  : '';

export function initMap(){
  const map = L.map('map', {
    // Canvas en vez de SVG: miles de trazos y paraderos sin un nodo DOM cada uno
    preferCanvas: true,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomControl: false
  });

  const light = L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png${CARTO_KEY_QS}`,
    { attribution: '&copy; OpenStreetMap & CARTO', maxZoom: MAX_ZOOM }
  ).addTo(map);

  const dark = L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png${CARTO_KEY_QS}`,
    { attribution: '&copy; OpenStreetMap & CARTO', maxZoom: MAX_ZOOM }
  );

  map.fitBounds(LIMA_BOUNDS);
  map.setMaxBounds(MAX_BOUNDS);

  if (SHOW_BOUNDS_RECT) {
    maxBoundsRect = L.rectangle(MAX_BOUNDS, {
      color: '#22c55e',
      weight: 1,
      fill: false,
      dashArray: '4 4'
    }).addTo(map);
  }

  L.control.zoom({ position:'bottomright' }).addTo(map);

  state.map = map;
  state.baseLayers.light = light;
  state.baseLayers.dark  = dark;

  // Crear panes para ordenar el dibujo
  ensureCustomPanes();
}

function getStopLatLng(sys, id){
  const s = sys.stops.get(id);
  if (!s) return null;
  return [s.lat, s.lon];
}

function ensureGroups(sys, id){
  if (!sys.lineLayers.has(id)) sys.lineLayers.set(id, L.layerGroup().addTo(state.map));
  if (!sys.stopLayers.has(id)) sys.stopLayers.set(id, L.layerGroup().addTo(state.map));
}

function clearServiceLayers(sys, id){
  const g1 = sys.lineLayers.get(id);
  const g2 = sys.stopLayers.get(id);
  if (g1) g1.clearLayers();
  if (g2) g2.clearLayers();
}

/* ===========================
   Macrorutas Metropolitano A/B
   =========================== */

// A y C siguen macro A; expresos macro B salvo el 10. Regulares: macro B.
function getMetMacroId(svc){
  const id   = String(svc.id).toUpperCase();
  const name = (svc.name || '').toUpperCase();

  if (id === 'A' || id === 'C') return 'A';

  if (svc.kind === 'expreso' || svc.kind === 'expreso corto' || svc.kind === 'expreso largo') {
    if (id === '10' || name.includes(' 10') || name.startsWith('10 ') || name.endsWith(' 10')) {
      return 'A';
    }
    return 'B';
  }

  return 'B';
}

// dirKey: 'sur' (norte->sur) o 'norte' (sur->norte)
function getMetStopsForDir(svc, dirKey){
  const kind = svc.kind;

  if (kind === 'expreso' || kind === 'expreso corto' || kind === 'expreso largo') {
    const ns = Array.isArray(svc.north_south) ? svc.north_south : [];
    const sn = Array.isArray(svc.south_north) ? svc.south_north : [];

    if (dirKey === 'sur')   return ns;
    if (dirKey === 'norte') return sn;
    return ns.concat(sn);
  }

  if (Array.isArray(svc.stops) && svc.stops.length) return svc.stops;

  return [];
}

// Recorta la macrorruta al tramo entre primer y último paradero del servicio
function cutMacroSegmentsToStops(segments, svc, dirKey){
  if (!segments || !segments.length) return segments;

  const sysMet = state.systems.met;
  const stopIds = getMetStopsForDir(svc, dirKey);
  if (!stopIds || stopIds.length === 0) return segments;

  const stopsMap = sysMet.stops;
  const startStop = stopsMap.get(stopIds[0]);
  const endStop   = stopsMap.get(stopIds[stopIds.length - 1]);
  if (!startStop || !endStop) return segments;

  const start = [startStop.lat, startStop.lon];
  const end   = [endStop.lat,   endStop.lon];

  const flat = [];
  for (let s = 0; s < segments.length; s++){
    const seg = segments[s];
    for (let i = 0; i < seg.length; i++){
      flat.push(seg[i]);
    }
  }
  if (flat.length < 2) return segments;

  const dist2 = (a, b) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx*dx + dy*dy;
  };

  let iStart = 0, dStart = Infinity;
  let iEnd   = 0, dEnd   = Infinity;

  for (let i = 0; i < flat.length; i++){
    const p = flat[i];
    const ds = dist2(p, start);
    if (ds < dStart){ dStart = ds; iStart = i; }
    const de = dist2(p, end);
    if (de < dEnd){ dEnd = de; iEnd = i; }
  }

  if (iStart > iEnd) { const t = iStart; iStart = iEnd; iEnd = t; }

  const slice = flat.slice(iStart, iEnd + 1);
  if (slice.length < 2) return segments;

  return [slice];
}

/**
 * Dibuja la macrorruta recortada a paraderos del servicio.
 */
function drawMetMacro(svc, routeDir, gLine, color, boundsIn, paneLine){
  const macros = (state.systems.met && state.systems.met.macros) || {};
  const macroId = getMetMacroId(svc);
  const def = macros[macroId];
  if (!def) return boundsIn;

  let bounds = boundsIn;

  const drawSegmentsDir = (segments) => {
    if (!segments) return;
    (segments || []).forEach(seg => {
      if (!Array.isArray(seg) || seg.length < 2) return;
      const poly = L.polyline(seg, { pane: paneLine, color, weight: 4, opacity: 0.95, lineCap:'round', lineJoin:'round' }).addTo(gLine);
      try { poly.setStyle({ color }); } catch {}
      forceStroke(poly, color);
      const b = poly.getBounds();
      bounds = bounds ? bounds.extend(b) : b;
    });
  };

  if (routeDir === 'ambas'){
    if (state.dir === 'ambas' || state.dir === 'ns') {
      const baseNS = def.north_south || [];
      const segNS  = cutMacroSegmentsToStops(baseNS, svc, 'sur');
      drawSegmentsDir(segNS);
    }
    if (state.dir === 'ambas' || state.dir === 'sn') {
      const baseSN = def.south_north || [];
      const segSN  = cutMacroSegmentsToStops(baseSN, svc, 'norte');
      drawSegmentsDir(segSN);
    }
  } else if (routeDir === 'norte') {
    const baseSN = def.south_north || [];
    const segSN  = cutMacroSegmentsToStops(baseSN, svc, 'norte');
    drawSegmentsDir(segSN);
  } else if (routeDir === 'sur') {
    const baseNS = def.north_south || [];
    const segNS  = cutMacroSegmentsToStops(baseNS, svc, 'sur');
    drawSegmentsDir(segNS);
  }

  return bounds;
}

/* ===========================
   Render de servicios
   =========================== */

export function renderService(systemId, id, opts={}){
  const { silentFit=false } = opts;
  const sys = state.systems[systemId];
  const svc = sys.services.find(s => String(s.id).toUpperCase() === String(id).toUpperCase());
  if (!svc) return;

  ensureGroups(sys, svc.id);
  clearServiceLayers(sys, svc.id);

  const gLine = sys.lineLayers.get(svc.id);
  const gStop = sys.stopLayers.get(svc.id);
  let bounds = null;

  const paneLine = getLinePane(systemId, svc);
  const paneStop = getStopPane(systemId, svc);

  const drawSegments = (segments, color) => {
    (segments||[]).forEach(seg => {
      if (!Array.isArray(seg) || seg.length < 2) return;
      const poly = L.polyline(seg, { pane: paneLine, color, weight: 4, opacity: 0.95, lineCap:'round', lineJoin:'round' }).addTo(gLine);
      try { poly.setStyle({ color }); } catch {}
      forceStroke(poly, color);
      const b = poly.getBounds();
      bounds = bounds ? bounds.extend(b) : b;
    });
  };

  const drawByStops = (ids, color) => {
    const pts = uniqueOrder(ids.map(st => getStopLatLng(sys, st)).filter(Boolean));
    if (pts.length >= 2){
      const poly = L.polyline(pts, { pane: paneLine, color, weight: 4, opacity: 0.95, lineCap:'round', lineJoin:'round' }).addTo(gLine);
      try { poly.setStyle({ color }); } catch {}
      forceStroke(poly, color);
      const b = poly.getBounds();
      bounds = bounds ? bounds.extend(b) : b;
    }
  };

  const routeDir = getDirFor(systemId, id);

  if (systemId === 'alim'){
    if (routeDir === 'ambas'){
      const segs = svc.geom.length
        ? svc.geom
        : [...(svc.geom_norte||[]), ...(svc.geom_sur||[])];
      drawSegments(segs, svc.color);
    } else if (routeDir === 'norte') {
      drawSegments(svc.geom_norte || svc.geom, svc.color);
    } else if (routeDir === 'sur') {
      drawSegments(svc.geom_sur   || svc.geom, svc.color);
    }

  } else if (systemId === 'met') {
    const prevBounds = bounds;
    bounds = drawMetMacro(svc, routeDir, gLine, svc.color, bounds, paneLine);
    if (bounds === prevBounds) {
      if (svc.kind === 'regular'){
        drawByStops(svc.stops || [], svc.color);
      } else {
        if (routeDir === 'ambas'){
          if (state.dir === 'ambas' || state.dir === 'ns') drawByStops(svc.north_south || [], svc.color);
          if (state.dir === 'ambas' || state.dir === 'sn') drawByStops(svc.south_north || [], svc.color);
        } else if (routeDir === 'norte'){
          drawByStops(svc.south_north || [], svc.color);
        } else if (routeDir === 'sur'){
          drawByStops(svc.north_south || [], svc.color);
        }
      }
    }

  } else if (systemId === 'corr'){
    const c = corrColorForSvc(svc);
    if (svc.segments?.length) drawSegments(svc.segments, c);
    else if (svc.stops?.length) drawByStops(svc.stops, c);

  } else if (systemId === 'metro'){
    drawSegments(svc.segments || [], svc.color);
  }

  // Paraderos
  let stopsToUse = [];

  if (Array.isArray(svc.stops) && svc.stops.length){
    stopsToUse = svc.stops;
  } else if (systemId === 'met') {
    const ns = Array.isArray(svc.north_south) ? svc.north_south : [];
    const sn = Array.isArray(svc.south_north) ? svc.south_north : [];

    if (routeDir === 'ambas'){
      if (state.dir === 'ambas')      stopsToUse = ns.concat(sn);
      else if (state.dir === 'ns')    stopsToUse = ns;
      else if (state.dir === 'sn')    stopsToUse = sn;
    } else if (routeDir === 'norte'){
      stopsToUse = sn;
    } else if (routeDir === 'sur'){
      stopsToUse = ns;
    }
  }

  if (state.showStops && Array.isArray(stopsToUse) && stopsToUse.length){
    const used = new Set();
    stopsToUse.forEach(st => {
      if (used.has(st)) return;
      used.add(st);
      const ll = getStopLatLng(sys, st);
      if (!ll) return;
      const marker = L.marker(ll, {
        pane: paneStop,
        icon: L.divIcon({ className:'stop-pin', iconSize:[16,16] })
      }).addTo(gStop);
      const nm = sys.stops.get(st)?.name || st;
      marker.bindTooltip(nm, { permanent:false, direction:'top' });
      marker.on('mouseover', () => setOverStop(true));
      marker.on('mouseout', () => setOverStop(false));
    });
  }

  const batch = currentFitBatch();
  if (bounds && batch) addBoundsToBatch(batch, bounds);
  if (state.autoFit && bounds && !silentFit) fitTo(bounds.pad(0.04));
}

export function hideService(systemId, id){
  const sys = state.systems[systemId];
  const g1 = sys.lineLayers.get(id);
  const g2 = sys.stopLayers.get(id);
  if (g1) g1.clearLayers();
  if (g2) g2.clearLayers();
}

export function onToggleService(systemId, id, checked, opts={}){
  if (checked) renderService(systemId, id, opts);
  else hideService(systemId, id);
}

// Re-render de lo visible
// Redibuja lo visible de un sistema (p. ej. al cambiar "Mostrar paradas")
export function reRenderVisibleSystem(sysId){
  // Wikiroutes: las capas ya están bien; solo cambian sus paraderos
  if (sysId==='wr'){
    state.systems.wr.layers?.forEach((_layer, id) => syncOneWrStopsVisibility(id));
    return;
  }

  const sel =
    sysId==='met'   ? '#p-met-reg .item input[type=checkbox], #p-met-exp .item input[type=checkbox]' :
    sysId==='alim'  ? '#p-met-alim .item input[type=checkbox]' :
    sysId==='corr'  ? '#p-corr .item input[type=checkbox]' :
    '#p-metro .item input[type=checkbox]';

  $$(sel).forEach(chk=>{
    // Corredores que se dibujan como capa Wikiroutes: no son servicios
    const { ida, vuelta, layer, id } = chk.dataset;
    if ((ida && vuelta) || layer || (sysId==='corr' && /^\d+$/.test(String(id)))) return;
    if (chk.checked) onToggleService(sysId, id, true, {silentFit:true});
    else hideService(sysId, id);
  });
}

export function reRenderVisible(){
  ['met','alim','corr','metro','wr'].forEach(reRenderVisibleSystem);
}

export function setBase(theme){
  if (theme === state.currentBase) return;
  state.map.removeLayer(state.baseLayers[state.currentBase]);
  state.map.addLayer(state.baseLayers[theme]);
  state.currentBase = theme;
}
