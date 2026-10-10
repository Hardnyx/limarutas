// Trip controller: coordinates data, input, results, map and shared links.
import { state } from './config.js';
import { $ } from './utils.js';
import { loadTripGraph } from './tripData.js';
import { planTrip } from './tripPlanner.js';
import { TRIP_END_EVENT } from './routeInspector.js';
import { setSheet } from './mobileSheet.js';
import { createTripForm } from './tripForm.js';
import { createTripResults } from './tripResults.js';
import { createTripMapRenderer } from './tripMapRenderer.js';

const ends = { from: null, to: null };
const model = { ends, graph: null, result: null, selected: 0 };
let picking = null;
const mapRenderer = createTripMapRenderer(model, { state, pickedPoint, syncInputs: () => form.syncInputs(), replan });
const form = createTripForm(model, { ensureGraph, setEnd, removePin: mapRenderer.removePin, addPin: mapRenderer.addPin,
  clearResults, syncUrl, startPicking, replan });
const { buildForm, setCompact, syncInputs, departure, setStatus } = form;
const { draw, addPin, removePin } = mapRenderer;
const results = createTripResults(model, { setCompact, departure, setDeparture: form.setDeparture, replan, shareTrip,
  onSelect(k){ if (model.selected !== k){ model.selected = k; void results.render(); draw(); } } });
function clearResults(){
  model.result = null;
  const box = $('#tripResults');
  if (box) box.innerHTML = '';
  mapRenderer.clear();
}

/* =========================
   Datos
   ========================= */

async function ensureGraph(){
  if (model.graph) return model.graph;
  setStatus('Cargando paraderos…');
  model.graph = await loadTripGraph();
  setStatus('');
  return model.graph;
}

function setEnd(end, point){
  ends[end] = point;
  removePin(end);
  addPin(end);
  syncInputs();
  // Solo un extremo: que se vea en el mapa
  const other = ends[end === 'from' ? 'to' : 'from'];
  if (!other && !state.map.getBounds().contains([point.lat, point.lon])){
    state.map.setView([point.lat, point.lon], Math.max(state.map.getZoom(), 14));
  }
  if (end === 'from' && !ends.to) $('#tripTo')?.focus();
  void replan();
}

/* =========================
   Elegir un punto en el mapa
   ========================= */

function startPicking(end){
  picking = end;
  state.tripPicking = end;
  document.documentElement.classList.add('trip-picking');
  setStatus(`Toca el mapa para elegir el ${end === 'from' ? 'origen' : 'destino'} (Esc cancela)`);
  setSheet('peek');
}

function stopPicking(){
  picking = null;
  state.tripPicking = null;
  document.documentElement.classList.remove('trip-picking');
}

async function pointLabel(lat, lon){
  await ensureGraph();
  const near = model.graph.nearestStops(lat, lon, 400)[0];
  return near ? `Cerca de ${model.graph.stops.name[near[0]]}` : 'Punto en el mapa';
}

// Punto elegido en el mapa: libre (la casa, el trabajo), salvo que caiga casi
// encima de un paradero (a SNAP_PX en pantalla y como mucho SNAP_MAX_M): ahí
// se entiende que se quiso ese paradero y se ajusta a él, con su nombre.
const SNAP_PX = 14;
const SNAP_MAX_M = 60;
async function pickedPoint(lat, lon){
  await ensureGraph();
  const map = state.map;
  const p = map.latLngToContainerPoint([lat, lon]);
  const mPerPx = map.distance(map.containerPointToLatLng(p), map.containerPointToLatLng([p.x + 1, p.y]));
  const near = model.graph.nearestStops(lat, lon, Math.min(SNAP_MAX_M, SNAP_PX * mPerPx))[0];
  if (near){
    const i = near[0];
    const { name, district } = model.graph.stops;
    return { lat: model.graph.stops.lat[i], lon: model.graph.stops.lon[i], label: [name[i], district[i]].filter(Boolean).join(' · ') };
  }
  return { lat, lon, label: await pointLabel(lat, lon) };
}

function wireMapPicking(){
  const box = state.map.getContainer();
  let down = null;
  // En captura: el clic de elegir no llega a Leaflet (ni abre el panel de rutas)
  box.addEventListener('pointerdown', (e) => { if (picking) down = { x: e.clientX, y: e.clientY }; }, true);
  box.addEventListener('click', async (e) => {
    if (!picking) return;
    if (e.target.closest('.leaflet-control')) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;   // fue un arrastre
    e.stopPropagation();
    const end = picking;
    stopPicking();
    const ll = state.map.mouseEventToLatLng(e);
    setStatus('');
    setEnd(end, await pickedPoint(ll.lat, ll.lng));
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picking){ stopPicking(); setStatus(''); }
  });
}

/* =========================
   Pines A y B
   ========================= */

/* =========================
   Calcular
   ========================= */

async function replan(){
  clearResults();
  model.selected = 0;
  if (!ends.from || !ends.to){ syncUrl(); return; }
  await ensureGraph();
  setStatus('Buscando opciones…');
  // Deja pintar el estado antes del cálculo
  await new Promise(res => setTimeout(res, 0));
  model.result = planTrip(model.graph, ends.from, ends.to, { includeOld: $('#tripOld').checked, at: departure() });
  setStatus('');
  syncUrl();
  await results.render();
  draw();
  if (model.result.options.length || model.result.walkOnly) setSheet('half');
}

/* =========================
   Enlace del viaje (?desde=lat,lon&hasta=lat,lon)
   ========================= */

const fmtPt = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
const parsePt = v => {
  const m = String(v || '').match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  return m ? { lat: +m[1], lon: +m[2] } : null;
};

// La URL refleja el viaje: se puede compartir o guardar
function syncUrl(){
  const url = new URL(window.location.href);
  ['desde', 'hasta'].forEach((k, i) => {
    const p = ends[i ? 'to' : 'from'];
    if (p) url.searchParams.set(k, fmtPt(p)); else url.searchParams.delete(k);
  });
  window.history.replaceState(null, '', url);
}

export function tripShareUrl(){
  const url = new URL(window.location.href);
  url.searchParams.delete('debug');
  return url.toString();
}

async function shareTrip(btn){
  const link = tripShareUrl();
  try {
    if (navigator.share && window.matchMedia('(max-width: 700px)').matches){
      await navigator.share({ title: 'Cómo llegar', url: link });
      return;
    }
    await navigator.clipboard.writeText(link);
    btn.textContent = 'Enlace copiado';
  } catch {
    window.prompt('Copia este enlace:', link);
  }
}

async function loadFromUrl(){
  const params = new URLSearchParams(window.location.search);
  const a = parsePt(params.get('desde'));
  const b = parsePt(params.get('hasta'));
  if (!a && !b) return;
  $('#tabTrip')?.click();
  if (a) a.label = await pointLabel(a.lat, a.lon);
  if (b) b.label = await pointLabel(b.lat, b.lon);
  await setTripEnds(a, b);
}

/* =========================
   Montaje
   ========================= */

export function wireTripUi(){
  const pane = $('#tripPane');
  if (!pane || !state.map || pane.dataset.tripWired) return;
  pane.dataset.tripWired = '1';
  mapRenderer.mount();
  buildForm(pane);
  wireMapPicking();

  // "Salir de aquí" / "Llegar aquí" desde el panel de un paradero
  document.addEventListener(TRIP_END_EVENT, (e) => {
    const { end, point } = e.detail || {};
    if (!point || (end !== 'from' && end !== 'to')) return;
    $('#tabTrip')?.click();
    setEnd(end, point);
  });
  void loadFromUrl();
}

// Para pruebas y para enlazar desde otras partes (p. ej. "Ir desde aquí")
export function setTripEnds(from, to){
  if (from) ends.from = from;
  if (to) ends.to = to;
  ['from', 'to'].forEach(k => { removePin(k); addPin(k); });
  // Solo un extremo (enlace a medias): que se vea
  const only = ends.from && !ends.to ? ends.from : (!ends.from && ends.to ? ends.to : null);
  if (only) state.map.setView([only.lat, only.lon], Math.max(state.map.getZoom(), 14));
  syncInputs();
  return replan();
}
