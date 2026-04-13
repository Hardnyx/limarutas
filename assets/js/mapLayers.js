// mapLayers.js
import { state, getDirFor } from './config.js';
import { $$, uniqueOrder } from './utils.js';
import { buildWikiroutesLayer } from './parsers.js';

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

/* ===========================
   Colores Corredores
   =========================== */

const CORR_COLORS = {
  '1': '#ffcd00', // Amarillo
  '2': '#e4002b', // Rojo
  '3': '#003594', // Azul
  '4': '#9b26b6', // Morado
  '5': '#8e8c13'  // Verde
};

const CORR_FALLBACK = '#9ca3af';

function normStr(v){
  return String(v ?? '').trim().toUpperCase();
}

function pickFirstNonEmpty(obj, keys){
  for (const k of keys){
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function digitFromCorrCode(sUpper){
  const s = normStr(sUpper);
  if (!s) return null;

  // 101, 204, 371...
  const m3 = s.match(/^([1-5])\d{2}\b/);
  if (m3) return m3[1];

  // "SE-02", "SP-01", "SE 02"
  if (/^(SE|SP)\b/.test(s)) return '4';

  // "COLE BUS", "COLEBUS", "COLE ..."
  if (/^COLE\b/.test(s) || /^COLEBUS\b/.test(s) || /^COLE\s*BUS\b/.test(s)) return '3';

  return null;
}

function digitFromKeywords(sUpper){
  const s = normStr(sUpper);
  if (!s) return null;

  if (s.includes('AMARILLO')) return '1';
  if (s.includes('ROJO')) return '2';
  if (s.includes('AZUL')) return '3';
  if (s.includes('MORADO')) return '4';
  if (s.includes('VERDE')) return '5';

  return null;
}

function corrColorForId(anyId){
  const s = normStr(anyId);
  const d = digitFromCorrCode(s) || digitFromKeywords(s);
  if (d && CORR_COLORS[d]) return CORR_COLORS[d];
  return CORR_FALLBACK;
}

function corrColorForSvc(svc){
  // Prioridad: code/ref/id, luego name/label, luego keywords
  const idLike = pickFirstNonEmpty(svc, ['id', 'code', 'ref', 'codigo', 'route', 'ruta', 'service', 'service_id']);
  const nameLike = pickFirstNonEmpty(svc, ['name', 'label', 'nombre', 'title', 'descripcion', 'description']);

  const d1 = digitFromCorrCode(idLike);
  if (d1 && CORR_COLORS[d1]) return CORR_COLORS[d1];

  // Si el id viene embebido en el nombre: "301 Principal", "Ruta 204", etc.
  const d2 = digitFromCorrCode(nameLike);
  if (d2 && CORR_COLORS[d2]) return CORR_COLORS[d2];

  const d3 = digitFromKeywords(idLike) || digitFromKeywords(nameLike);
  if (d3 && CORR_COLORS[d3]) return CORR_COLORS[d3];

  // Como último recurso, si svc.color existe y es un hex válido y no es gris, úsalo
  const c = String(svc?.color ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c) && c.toLowerCase() !== CORR_FALLBACK) return c;

  return CORR_FALLBACK;
}

// Fuerza stroke cuando Leaflet está en SVG y algún CSS lo pisa
function forceStroke(layer, color){
  try {
    const p = layer && layer._path;
    if (!p) return;

    p.setAttribute('stroke', color);

    // inline style normal
    p.style.stroke = color;

    // inline style con prioridad
    if (p.style && p.style.setProperty) {
      p.style.setProperty('stroke', color, 'important');
      p.style.setProperty('stroke-opacity', '0.95', 'important');
      p.style.setProperty('fill', 'none', 'important');
    }
  } catch {}
}

/* ===========================
   Panes (orden de dibujo)
   =========================== */

const PANES = {
  // Wikiroutes (transporte general) se queda en el overlayPane por defecto (zIndex 400)
  alimLine: 'alimLinePane',
  corrLine: 'corrLinePane',
  metroLine: 'metroLinePane',
  metLine: 'metLinePane',
  metTopLine: 'metTopLinePane',

  stop: 'stopPane',
  metTopStop: 'metTopStopPane'
};

const Z = {
  // overlayPane default ~400. Ponemos capas "prioritarias" por encima.
  alimLine: 430,
  corrLine: 440,
  metroLine: 450,
  metLine: 460,
  metTopLine: 470,

  // markerPane default ~600. Creamos panes propios ligeramente arriba.
  stop: 610,
  metTopStop: 620
};

function ensurePane(map, name, zIndex){
  if (map.getPane(name)) return;
  const p = map.createPane(name);
  p.style.zIndex = String(zIndex);
}

function ensureCustomPanes(){
  const map = state.map;
  ensurePane(map, PANES.alimLine, Z.alimLine);
  ensurePane(map, PANES.corrLine, Z.corrLine);
  ensurePane(map, PANES.metroLine, Z.metroLine);
  ensurePane(map, PANES.metLine, Z.metLine);
  ensurePane(map, PANES.metTopLine, Z.metTopLine);

  ensurePane(map, PANES.stop, Z.stop);
  ensurePane(map, PANES.metTopStop, Z.metTopStop);
}

function getLinePane(systemId, svc){
  if (systemId === 'met'){
    const idU = String(svc?.id ?? '').toUpperCase();
    if (idU === 'B' || idU === 'C') return PANES.metTopLine;
    return PANES.metLine;
  }
  if (systemId === 'metro') return PANES.metroLine;
  if (systemId === 'corr') return PANES.corrLine;
  if (systemId === 'alim') return PANES.alimLine;
  return undefined; // WR y otros: pane por defecto
}

function getStopPane(systemId, svc){
  if (systemId === 'met'){
    const idU = String(svc?.id ?? '').toUpperCase();
    if (idU === 'B' || idU === 'C') return PANES.metTopStop;
  }
  return PANES.stop;
}

export function initMap(){
  const map = L.map('map', {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomControl: false
  });

  const light = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap & CARTO', maxZoom: MAX_ZOOM }
  ).addTo(map);

  const dark = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
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

export function fitTo(bounds){
  if (!bounds) return;
  const leftPad = document.getElementById('sidebar')?.offsetWidth ?? 380;
  state.map.fitBounds(bounds, {
    paddingTopLeft: [leftPad + 20, 40],
    paddingBottomRight: [30, 40]
  });
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
    });
  }

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

/* ===========================
   Wikiroutes con viajes (lazy)
   =========================== */

// Paradas WR on/off según visibilidad de cada subcapa
function syncOneWrStopsVisibility(id){
  const wr = state.systems.wr;
  const g = wr.layers?.get(id);
  const stopSub = wr.stopLayers?.get(id);
  if (!stopSub) return;

  const routeVisible = g && state.map.hasLayer(g);
  const shouldShowStops = routeVisible && state.showStops;

  if (shouldShowStops) {
    if (!state.map.hasLayer(stopSub)) stopSub.addTo(state.map);
  } else {
    if (state.map.hasLayer(stopSub)) state.map.removeLayer(stopSub);
  }
}

function wrBaseId(id){
  return String(id).replace(/-(ida|vuelta)$/i, '');
}

function wrCounterpartId(id){
  const s = String(id);
  if (/-ida$/i.test(s)) return s.replace(/-ida$/i, '-vuelta');
  if (/-vuelta$/i.test(s)) return s.replace(/-vuelta$/i, '-ida');
  return null;
}

function wrHasDefOrLayer(id){
  const wr = state.systems.wr;
  return !!(wr.layers?.has(id) || wr.routeDefs?.has(id));
}

function isCorrLikeWrId(id){
  const base = wrBaseId(id);
  const s = normStr(base);

  // 3 dígitos 1xx..5xx
  if (/^[1-5]\d{2}$/.test(s)) return true;

  // SE/SP
  if (/^(SE|SP)[-_ ]?\d{2}$/.test(s)) return true;

  // COLE BUS
  if (/^COLE\b/.test(s) || /^COLEBUS\b/.test(s) || /^COLE\s*BUS\b/.test(s)) return true;

  return false;
}

function corrColorForWrId(id){
  const base = wrBaseId(id);
  return corrColorForId(base);
}

async function ensureWrLayer(id){
  const wr = state.systems.wr;

  if (wr.layers?.has(id)) return true;

  const def = wr.routeDefs?.get(id);
  if (!def) return false;

  if (!wr._buildPromises) wr._buildPromises = new Map();

  if (!wr._buildPromises.has(id)) {
    const p = (async () => {
      // Si el ID WR parece un corredor (101, 301, SE-02, SP-01, COLE BUS),
      // sobreescribe el color al del corredor.
      const autoColor = isCorrLikeWrId(id) ? corrColorForWrId(id) : null;
      const colorToUse = autoColor && autoColor !== CORR_FALLBACK ? autoColor : def.color;

      await buildWikiroutesLayer(String(id), def.folder, { color: colorToUse, trip: def.trip });

      // Post-fix: si el layer quedó en SVG y algo pisó el stroke, forzar.
      const g = wr.layers?.get(id);
      if (g && g.eachLayer && isCorrLikeWrId(id) && colorToUse) {
        try {
          g.eachLayer(sub => {
            if (sub && typeof sub.setStyle === 'function') {
              try { sub.setStyle({ color: colorToUse }); } catch {}
            }
            forceStroke(sub, colorToUse);
            if (sub && typeof sub.eachLayer === 'function') {
              sub.eachLayer(ch => {
                if (ch && typeof ch.setStyle === 'function') {
                  try { ch.setStyle({ color: colorToUse }); } catch {}
                }
                forceStroke(ch, colorToUse);
              });
            }
          });
        } catch {}
      }
    })()
      .catch(e => {
        console.warn('[WR] No se pudo construir capa', id, e?.message || e);
      })
      .finally(() => {
        try { wr._buildPromises.delete(id); } catch {}
      });

    wr._buildPromises.set(id, p);
  }

  await wr._buildPromises.get(id);
  return wr.layers?.has(id);
}

function hideWrSub(id){
  const wr = state.systems.wr;
  const g = wr.layers?.get(id);
  if (g && state.map.hasLayer(g)) state.map.removeLayer(g);

  const stopSub = wr.stopLayers?.get(id);
  if (stopSub && state.map.hasLayer(stopSub)) state.map.removeLayer(stopSub);
}

async function showWrSubAsync(id, fit){
  const wr = state.systems.wr;

  // Exclusión automática por convención -ida/-vuelta
  const other = wrCounterpartId(id);
  if (other) hideWrSub(other);

  const ok = await ensureWrLayer(id);
  if (!ok) return;

  const g = wr.layers?.get(id);
  if (!g) return;

  if (!state.map.hasLayer(g)) g.addTo(state.map);
  syncOneWrStopsVisibility(id);

  if (fit && wr.bounds?.get(id) && state.autoFit) fitTo(wr.bounds.get(id).pad(0.04));
}

function showWrSub(id, fit){
  void showWrSubAsync(id, fit);
}

// Resolver ida/vuelta desde el DOM si existe, con fallback por convención
function resolveWrPair(id){
  const wr = state.systems.wr;
  const root = document.getElementById('p-wr');

  const hasPairData = (el) => !!(el && (el.dataset.ida || el.dataset.vuelta));

  const s = String(id);
  const base = wrBaseId(s);

  if (root) {
    const pick = (pid) =>
      root.querySelector(`.item input[type="checkbox"][data-id="${pid}"]`);

    const leafExact = pick(s);
    if (hasPairData(leafExact)) {
      return {
        parentId: s,
        ida: leafExact.dataset.ida || null,
        vuelta: leafExact.dataset.vuelta || null,
        sel: leafExact.dataset.sel || 'ida',
        leaf: leafExact
      };
    }

    const leafBase = pick(base);
    if (hasPairData(leafBase)) {
      return {
        parentId: base,
        ida: leafBase.dataset.ida || null,
        vuelta: leafBase.dataset.vuelta || null,
        sel: leafBase.dataset.sel || 'ida',
        leaf: leafBase
      };
    }
  }

  // Si el id no tiene sufijo ida/vuelta, buscar si existe -ida o -vuelta directamente
  if (base === s) {
    const idaKey    = `${s}-ida`;
    const vueltaKey = `${s}-vuelta`;
    if (wrHasDefOrLayer(idaKey) || wrHasDefOrLayer(vueltaKey)) {
      return {
        parentId: s,
        ida:    wrHasDefOrLayer(idaKey)    ? idaKey    : null,
        vuelta: wrHasDefOrLayer(vueltaKey) ? vueltaKey : null,
        sel:    'ida',
        leaf:   null
      };
    }
  }

  // Fallback por convención si el id parece subcapa
  if (base !== s) {
    const ida    = `${base}-ida`;
    const vuelta = `${base}-vuelta`;
    const sel    = /-vuelta$/i.test(s) ? 'vuelta' : 'ida';

    if (wrHasDefOrLayer(ida) || wrHasDefOrLayer(vuelta)) {
      return { parentId: base, ida, vuelta, sel, leaf: null };
    }
  }

  return null;
}

function applyWrPairVisibility(pair, checked, fit){
  const showId  = pair.sel === 'vuelta' ? pair.vuelta : pair.ida;
  const otherId = pair.sel === 'vuelta' ? pair.ida   : pair.vuelta;

  if (checked) {
    if (otherId) hideWrSub(otherId);
    if (showId)  showWrSub(showId, fit);
  } else {
    if (pair.ida) hideWrSub(pair.ida);
    if (pair.vuelta) hideWrSub(pair.vuelta);
  }
}

// API pública: acepta id real (subcapa) o id padre
export function setWikiroutesVisible(id, visible, { fit=false } = {}){
  const wr = state.systems.wr;

  // 1) Si es una subcapa real (ya construida) o definida (lazy), actúa directo.
  if (wrHasDefOrLayer(id)) {
    if (visible) showWrSub(id, fit);
    else hideWrSub(id);
    return;
  }

  // 2) Si es un "padre" Ida/Vuelta, usa el par (DOM o convención)
  const pair = resolveWrPair(id);
  const pairValid =
    pair &&
    ((pair.ida && wrHasDefOrLayer(pair.ida)) || (pair.vuelta && wrHasDefOrLayer(pair.vuelta)));

  if (pairValid) {
    applyWrPairVisibility(pair, visible, fit);
  }
}

// Compatibilidad: se mantiene esta API para el sidebar
export function setWikiroutesVisibleLeaf(parentId, checked, { fit=false } = {}){
  const wr = state.systems.wr;
  const pair = resolveWrPair(parentId);

  const pairValid =
    pair &&
    ((pair.ida && wrHasDefOrLayer(pair.ida)) || (pair.vuelta && wrHasDefOrLayer(pair.vuelta)));

  if (pairValid) {
    applyWrPairVisibility(pair, checked, fit);
    return;
  }

  // No es par, interpretarlo como capa simple con ese id
  if (wrHasDefOrLayer(parentId)) {
    if (checked) showWrSub(parentId, fit);
    else hideWrSub(parentId);
  }
}

// Cambiar IDA/VUELTA de un padre ya existente
export function setWikiroutesTrip(parentId, trip, { fit=false } = {}){
  const wr = state.systems.wr;
  const pair = resolveWrPair(parentId);

  const pairValid =
    pair &&
    ((pair.ida && wrHasDefOrLayer(pair.ida)) || (pair.vuelta && wrHasDefOrLayer(pair.vuelta)));

  if (!pairValid) return;

  const sel = trip === 2 ? 'vuelta' : 'ida';
  pair.sel = sel;
  if (pair.leaf) pair.leaf.dataset.sel = sel;

  const isVisible = (() => {
    if (pair.leaf && pair.leaf.checked) return true;
    const v = (rid) => {
      const g = wr.layers?.get(rid);
      return !!(g && state.map.hasLayer(g));
    };
    return (pair.ida && v(pair.ida)) || (pair.vuelta && v(pair.vuelta));
  })();

  if (isVisible) {
    applyWrPairVisibility(pair, true, fit);
  }
}

// Re-render de lo visible
export function reRenderVisibleSystem(sysId){
  const sel =
    sysId==='met'   ? '#p-met-reg .item input[type=checkbox], #p-met-exp .item input[type=checkbox]' :
    sysId==='alim'  ? '#p-met-alim .item input[type=checkbox]' :
    sysId==='corr'  ? '#p-corr .item input[type=checkbox]' :
    sysId==='wr'    ? '#p-wr .item input[type=checkbox]' :
    '#p-metro .item input[type=checkbox]';

  $$(sel).forEach(chk=>{
    if (sysId==='wr'){
      setWikiroutesVisible(chk.dataset.id, chk.checked, { fit:true });
    } else {
      if (chk.checked) onToggleService(sysId, chk.dataset.id, true, {silentFit:true});
      else hideService(sysId, chk.dataset.id);
    }
  });

  if (sysId==='wr'){
    const wr = state.systems.wr;
    wr.layers?.forEach((_layer, id) => syncOneWrStopsVisibility(id));
  }
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
