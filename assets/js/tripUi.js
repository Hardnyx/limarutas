// tripUi.js
// Pestaña "Cómo llegar" (nueva interfaz): origen y destino (paradero o punto
// en el mapa), opciones de viaje (tripPlanner.js) y su dibujo en el mapa.
import { state } from './config.js';
import { $, el } from './utils.js';
import { loadTripGraph } from './tripData.js';
import { planTrip, oldWouldHelp } from './tripPlanner.js';
import { fitTo } from './mapFit.js';
import { paintTag } from './routeInspector.js';
import { setSheet } from './mobileSheet.js';

const LINE_PANE = 'tripLinePane';     // sobre las rutas y sus paraderos
const MARK_PANE = 'tripMarkPane';
const MAX_SUGGEST = 8;

const ends = { from: null, to: null };   // { lat, lon, label }
let graph = null;
let tripLayer = null;
let pins = { from: null, to: null };
let picking = null;                       // 'from' | 'to' mientras se elige en el mapa
let last = null;                          // último resultado de planTrip
let selected = 0;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtM = m => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
const walkMinOf = m => Math.max(1, Math.round((m * 1.3) / 75));

/* =========================
   Datos
   ========================= */

async function ensureGraph(){
  if (graph) return graph;
  setStatus('Cargando paraderos…');
  graph = await loadTripGraph();
  setStatus('');
  return graph;
}

// Nombres de paraderos para sugerir: uno por nombre y distrito (el que más rutas tiene)
let stopChoices = null;
function choices(){
  if (stopChoices) return stopChoices;
  const byKey = new Map();
  const { name, district, lat, lon } = graph.stops;
  for (let i = 0; i < graph.stops.count; i++){
    if (!name[i] || !graph.atStop[i].length) continue;
    const key = `${norm(name[i])}|${district[i]}`;
    const n = graph.atStop[i].length;
    const cur = byKey.get(key);
    if (!cur || n > cur.n) byKey.set(key, { i, n, name: name[i], district: district[i], lat: lat[i], lon: lon[i], q: norm(name[i]) });
  }
  stopChoices = Array.from(byKey.values()).sort((a, b) => b.n - a.n);
  return stopChoices;
}

// Primero los que tienen todas las palabras; si no hay, los que coinciden en
// más texto ("ovalo higuereta" → "Higuereta"). Las palabras cortas ("de") no bastan solas.
function suggestStops(text){
  const words = norm(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const all = [];
  const some = [];
  for (const c of choices()){
    const hit = words.filter(w => c.q.includes(w));
    if (hit.length === words.length){
      all.push(c);
      if (all.length >= MAX_SUGGEST) return all;
    } else if (hit.some(w => w.length >= 4)){
      // Cuánto del texto coincide: "higuereta" pesa más que "ovalo"
      some.push([hit.reduce((n, w) => n + w.length, 0), c]);
    }
  }
  if (all.length) return all;
  return some.sort((x, y) => y[0] - x[0] || y[1].n - x[1].n).slice(0, MAX_SUGGEST).map(x => x[1]);
}

/* =========================
   Formulario
   ========================= */

function setStatus(text){
  const s = $('#tripStatus');
  if (s) s.textContent = text;
}

function field(end, letter, placeholder){
  const input = el('input', {
    type: 'text', id: end === 'from' ? 'tripFrom' : 'tripTo', class: 'trip-input',
    placeholder, autocomplete: 'off', 'aria-label': placeholder
  });
  const pick = el('button', { type: 'button', class: 'trip-pick', 'data-end': end,
    title: 'Elegir en el mapa', 'aria-label': `Elegir ${end === 'from' ? 'origen' : 'destino'} en el mapa` }, '📍');
  const clear = el('button', { type: 'button', class: 'trip-clear', 'data-end': end, 'aria-label': 'Borrar' }, '×');
  const list = el('div', { class: 'suggest trip-suggest', role: 'listbox' });
  const wrap = el('div', { class: 'trip-field', 'data-end': end },
    el('span', { class: `trip-dot trip-dot-${end}` }, letter), input, clear, pick, list);

  let items = [];
  let active = -1;
  const close = () => { list.classList.remove('open'); list.innerHTML = ''; items = []; active = -1; };
  const choose = (c) => {
    close();
    setEnd(end, { lat: c.lat, lon: c.lon, label: `${c.name} · ${c.district}` });
  };
  const render = () => {
    list.innerHTML = '';
    items.forEach((c, k) => {
      const row = el('div', { class: `suggest-item${k === active ? ' selected' : ''}`, role: 'option' },
        el('span', { class: 's-ico s-ico-stop' }, '●'),
        el('div', {}, el('div', { class: 's-label' }, c.name), el('div', { class: 's-sub' }, `${c.district} · ${c.n} rutas`)));
      row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(c); });
      list.appendChild(row);
    });
    list.classList.toggle('open', items.length > 0);
  };

  input.addEventListener('focus', () => { void ensureGraph(); });
  input.addEventListener('input', async () => {
    ends[end] = null;
    removePin(end);
    clearResults();
    if (!input.value.trim()){ close(); return; }
    await ensureGraph();
    items = suggestStops(input.value);
    active = items.length ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length){ e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp' && items.length){ e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Enter' && active >= 0){ e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape' && list.classList.contains('open')){ e.stopPropagation(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  clear.addEventListener('click', () => { input.value = ''; ends[end] = null; removePin(end); clearResults(); close(); input.focus(); });
  pick.addEventListener('click', () => startPicking(end));
  return wrap;
}

function buildForm(pane){
  pane.innerHTML = '';
  const oldChk = el('input', { type: 'checkbox', id: 'tripOld' });
  pane.append(
    el('div', { class: 'trip-form' },
      field('from', 'A', 'Origen: paradero o 📍 en el mapa'),
      field('to', 'B', 'Destino: paradero o 📍 en el mapa'),
      el('div', { class: 'trip-row' },
        el('label', { class: 'trip-old' }, oldChk, 'Incluir rutas antiguas'),
        el('button', { type: 'button', id: 'tripSwap', class: 'btn small btn-ghost', title: 'Intercambiar origen y destino' }, '⇅ Invertir'))),
    el('div', { id: 'tripStatus', class: 'muted trip-status', role: 'status' }),
    el('div', { id: 'tripResults', class: 'trip-results' }));

  oldChk.addEventListener('change', () => { void replan(); });
  $('#tripSwap').addEventListener('click', () => {
    [ends.from, ends.to] = [ends.to, ends.from];
    ['from', 'to'].forEach(k => { removePin(k); if (ends[k]) addPin(k); });
    syncInputs();
    void replan();
  });
}

function syncInputs(){
  $('#tripFrom').value = ends.from?.label || '';
  $('#tripTo').value = ends.to?.label || '';
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
  const near = graph.nearestStops(lat, lon, 400)[0];
  return near ? `Punto en el mapa · cerca de ${graph.stops.name[near[0]]}` : 'Punto en el mapa';
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
    setEnd(end, { lat: ll.lat, lon: ll.lng, label: await pointLabel(ll.lat, ll.lng) });
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picking){ stopPicking(); setStatus(''); }
  });
}

/* =========================
   Pines A y B
   ========================= */

function addPin(end){
  const p = ends[end];
  if (!p) return;
  const icon = L.divIcon({ className: `trip-pin trip-pin-${end}`, html: end === 'from' ? 'A' : 'B', iconSize: [28, 28], iconAnchor: [14, 14] });
  const m = L.marker([p.lat, p.lon], { icon, draggable: true, pane: MARK_PANE, keyboard: false, title: end === 'from' ? 'Origen' : 'Destino' }).addTo(state.map);
  m.on('dragend', async () => {
    const ll = m.getLatLng();
    ends[end] = { lat: ll.lat, lon: ll.lng, label: await pointLabel(ll.lat, ll.lng) };
    syncInputs();
    void replan();
  });
  pins[end] = m;
}

function removePin(end){
  if (pins[end]){ pins[end].remove(); pins[end] = null; }
}

/* =========================
   Resultados
   ========================= */

function clearResults(){
  last = null;
  const box = $('#tripResults');
  if (box) box.innerHTML = '';
  if (tripLayer) tripLayer.clearLayers();
}

function colorOf(route){
  const tag = route.leaf.closest('.item')?.querySelector('.item-head .left .tag');
  if (tag?.style.background) return tag.style.background;
  const svc = state.systems[route.system]?.services?.find(s => String(s.id) === route.leaf.dataset.id);
  return svc?.color || '#3b82f6';
}

// Nombre por el que se conoce la ruta: empresa y alias ("Unidos de Pasajeros ·
// La 73-1"), el que muestra su fila en la pestaña Rutas
function routeName(route){
  const item = route.leaf.closest('.item');
  let name = item?.querySelector('.item-head .name')?.textContent?.trim() || '';
  if (route.group === 'corredor'){
    // "Servicio 205" no dice nada: el corredor sí ("Corredor Rojo")
    const titles = [];
    for (let p = item?.closest('section.panel'); p; p = p.parentElement?.closest('section.panel')){
      const t = p.querySelector(':scope > .panel-head .title')?.firstChild?.textContent?.trim();
      if (t) titles.push(t);
    }
    return titles.find(t => /^Corredor\b/i.test(t)) || 'Corredor';
  }
  if (route.group === 'metropolitano') return `Metropolitano · ${name || route.code}`;
  if (route.group === 'metro') return `Metro de Lima · ${name.replace(/^Línea\s+L/i, 'Línea ') || route.code}`;
  if (name && name !== route.code) return name;
  const m = item?.__wrMeta;
  return [m?.empresa_operadora, m?.alias].filter(Boolean).join(' · ');
}

function chip(route){
  const c = el('span', { class: 'tag trip-chip' }, route.code);
  paintTag(c, colorOf(route));
  const name = routeName(route);
  if (name) c.title = name;
  return c;
}

const stopName = i => graph.stops.name[i] || 'paradero';
const headsign = r => stopName(r.stops[r.stops.length - 1]);

function stepsOf(opt){
  const steps = [];
  opt.legs.forEach((leg, k) => {
    if (leg.type === 'walk'){
      if (leg.m < 15) return;
      const where = k === 0 ? `hasta ${stopName(leg.to)}`
        : k === opt.legs.length - 1 ? 'hasta tu destino'
          : `hasta ${stopName(leg.to)} para el transbordo`;
      steps.push(el('li', { class: 'trip-step trip-step-walk' },
        el('span', { class: 'trip-step-ico' }, '🚶'),
        el('span', {}, `Camina ${fmtM(leg.m)} ${where}`, el('span', { class: 'trip-sub' }, ` · ${walkMinOf(leg.m)} min`))));
    } else {
      const r = leg.route;
      const n = leg.to - leg.from;
      const alts = leg.alts || [];
      const text = el('span', {},
        'Sube a la ', chip(r), ' en ', el('b', {}, stopName(r.stops[leg.from])),
        ' y baja en ', el('b', {}, stopName(r.stops[leg.to])),
        el('span', { class: 'trip-sub' }, ` · ${n} paradero${n === 1 ? '' : 's'} · dirección ${headsign(r)}`));
      if (alts.length){
        const also = el('div', { class: 'trip-also' }, 'O la que pase primero: ');
        alts.forEach((a, i) => { if (i) also.append(' '); also.append(chip(a.route)); });
        text.append(also);
      }
      if (r.group === 'antigua'){
        text.append(' ', el('span', { class: 'trip-warn' }, r.verified ? 'Sin autorización ATU' : 'Ruta antigua · podría no circular'));
      }
      steps.push(el('li', { class: 'trip-step trip-step-ride' },
        el('span', { class: 'trip-step-ico' }, r.group === 'metro' ? '🚇' : '🚌'), text));
    }
  });
  return steps;
}

// Un tramo en una línea: la ruta principal con su nombre y, si otras hacen
// lo mismo, "+N" (al pasar el mouse, cuáles)
function legRow(leg){
  const alts = (leg.alts || []).map(a => a.route);
  const row = el('div', { class: 'trip-leg-row' }, chip(leg.route),
    el('span', { class: 'trip-name' }, routeName(leg.route)));
  if (alts.length){
    row.append(el('span', {
      class: 'trip-plus',
      title: 'También te sirven:\n' + alts.map(r => `${r.code} ${routeName(r)}`).join('\n')
    }, `+${alts.length}`));
  }
  return row;
}

function card(opt, k){
  const rides = opt.legs.filter(l => l.type === 'ride');
  const isOpen = k === selected;
  const legs = el('div', { class: 'trip-legs' }, ...rides.map(legRow));
  const where = opt.transfers ? `1 transbordo en ${stopName(rides[1].route.stops[rides[1].from])}` : 'Directo';
  const head = el('div', { class: 'trip-card-head' }, legs,
    el('div', { class: 'trip-time' }, `~${opt.minutes}`, el('small', {}, ' min')));
  const body = el('div', { class: 'trip-card', role: 'button', tabindex: '0', 'aria-expanded': String(isOpen) },
    head, el('div', { class: 'trip-meta' }, `${where} · ${fmtM(opt.walkM)} a pie`));
  if (opt.old) body.append(el('div', { class: 'trip-warn' }, 'Usa una ruta antigua: podría no circular'));
  if (isOpen){
    body.classList.add('selected');
    const ol = el('ol', { class: 'trip-steps' }, ...stepsOf(opt));
    const show = el('button', { type: 'button', class: 'btn small btn-ghost trip-show' }, 'Ver estas rutas completas (pestaña Rutas)');
    show.addEventListener('click', (e) => {
      e.stopPropagation();
      rides.forEach(l => { if (!l.route.leaf.checked) l.route.leaf.click(); });
      $('#tabRoutes')?.click();
    });
    body.append(ol, show);
  }
  const pickCard = () => { if (selected !== k){ selected = k; renderResults(); draw(); } };
  body.addEventListener('click', pickCard);
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pickCard(); } });
  return body;
}

async function renderResults(){
  const box = $('#tripResults');
  if (!box || !last) return;
  box.innerHTML = '';
  if (last.walkOnly){
    box.append(el('div', { class: 'trip-empty' },
      `Está a ${fmtM(last.meters)}: te conviene caminar (unos ${walkMinOf(last.meters)} min).`));
    return;
  }
  if (!last.options.length){
    const msg = el('div', { class: 'trip-empty' }, 'No encontramos un viaje directo ni con un transbordo entre estos puntos.');
    box.append(msg);
    if (!$('#tripOld').checked && oldWouldHelp(graph, ends.from, ends.to)){
      const b = el('button', { type: 'button', class: 'btn small' }, 'Buscar también con rutas antiguas');
      b.addEventListener('click', () => { $('#tripOld').checked = true; void replan(); });
      msg.append(el('div', { class: 'trip-empty-hint' }, 'Hay opciones con rutas antiguas, que podrían ya no circular. ', b));
    }
    return;
  }
  last.options.forEach((opt, k) => box.append(card(opt, k)));
  box.append(el('div', { class: 'muted trip-note' }, 'Tiempos estimados por distancia; no incluyen la espera del bus.'));
}

/* =========================
   Dibujo en el mapa
   ========================= */

// Trazos de Wikiroutes (route_track_trip<N>.geojson), para dibujar el tramo
// por las calles y no en línea recta entre paraderos
const tracks = new Map();
function loadTrack(key){
  if (tracks.has(key)) return tracks.get(key);
  const def = state.systems.wr.routeDefs?.get(key);
  const p = !def ? Promise.resolve(null)
    : fetch(`${def.folder}/route_track_trip${def.trip || 1}.geojson`)
      .then(r => (r.ok ? r.json() : null))
      .then(gj => {
        const f = gj?.features?.find(x => x.geometry?.type === 'LineString');
        return f ? f.geometry.coordinates.map(([lo, la]) => [la, lo]) : null;
      })
      .catch(() => null);
  tracks.set(key, p);
  return p;
}

const d2 = (a, b) => (a[0] - b[0]) ** 2 + ((a[1] - b[1]) * 0.978) ** 2;
function nearestIdx(line, p, from = 0){
  let best = -1, bd = Infinity;
  for (let i = from; i < line.length; i++){
    const d = d2(line[i], p);
    if (d < bd){ bd = d; best = i; }
  }
  return [best, bd];
}

// Tramo del trazo entre el paradero de subida y el de bajada; si el trazo no
// está cargado o no calza (~150 m), línea entre paraderos
const loadedTracks = new Map();
function rideCoords(r, leg, pt){
  const stops = Array.from(r.stops.slice(leg.from, leg.to + 1), pt);
  const line = loadedTracks.get(r.key);
  if (!line) return stops;
  const TOL = (150 / 111_000) ** 2;
  const [i, di] = nearestIdx(line, stops[0]);
  const [j, dj] = nearestIdx(line, stops[stops.length - 1], Math.max(0, i));
  if (i < 0 || j <= i || di > TOL || dj > TOL) return stops;
  return [stops[0], ...line.slice(i, j + 1), stops[stops.length - 1]];
}

async function drawWithTracks(){
  const opt = last?.options?.[selected];
  if (!opt) return;
  const keys = opt.legs.filter(l => l.type === 'ride' && !/^(met|metro):/.test(l.route.key)).map(l => l.route.key);
  const missing = keys.filter(k => !loadedTracks.has(k));
  if (!missing.length) return;
  const lines = await Promise.all(missing.map(loadTrack));
  missing.forEach((k, i) => { if (lines[i]) loadedTracks.set(k, lines[i]); });
  if (last?.options?.[selected] === opt) draw({ fit: false });
}

function draw({ fit = true } = {}){
  if (!tripLayer) tripLayer = L.layerGroup().addTo(state.map);
  tripLayer.clearLayers();
  const opt = last?.options?.[selected];
  if (!opt) return;
  const { lat, lon } = graph.stops;
  const pt = i => [lat[i], lon[i]];
  const all = [];
  const walk = (a, b) => {
    tripLayer.addLayer(L.polyline([a, b], { pane: LINE_PANE, color: '#64748b', weight: 4, dashArray: '2 8', lineCap: 'round', interactive: false }));
    all.push(a, b);
  };

  let prev = [ends.from.lat, ends.from.lon];
  opt.legs.forEach((leg, k) => {
    if (leg.type === 'walk'){
      const next = k === opt.legs.length - 1 ? [ends.to.lat, ends.to.lon] : pt(leg.to);
      const start = leg.from != null ? pt(leg.from) : prev;
      walk(start, next);
      prev = next;
      return;
    }
    const r = leg.route;
    const coords = rideCoords(r, leg, pt);
    const color = colorOf(r);
    tripLayer.addLayer(L.polyline(coords, { pane: LINE_PANE, color: '#fff', weight: 10, opacity: 0.9, interactive: false }));
    tripLayer.addLayer(L.polyline(coords, { pane: LINE_PANE, color, weight: 6, interactive: false }));
    [coords[0], coords[coords.length - 1]].forEach(c => tripLayer.addLayer(
      L.circleMarker(c, { pane: MARK_PANE, radius: 6, color, weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false })));
    all.push(...coords);
    prev = coords[coords.length - 1];
  });
  if (fit && all.length) fitTo(L.latLngBounds(all));
  void drawWithTracks();
}

/* =========================
   Calcular
   ========================= */

async function replan(){
  clearResults();
  selected = 0;
  if (!ends.from || !ends.to) return;
  await ensureGraph();
  setStatus('Buscando opciones…');
  // Deja pintar el estado antes del cálculo
  await new Promise(res => setTimeout(res, 0));
  last = planTrip(graph, ends.from, ends.to, { includeOld: $('#tripOld').checked });
  setStatus('');
  await renderResults();
  draw();
  if (last.options.length || last.walkOnly) setSheet('half');
}

/* =========================
   Montaje
   ========================= */

export function wireTripUi(){
  const pane = $('#tripPane');
  if (!pane || !state.map || pane.dataset.tripWired) return;
  pane.dataset.tripWired = '1';
  [[LINE_PANE, 480], [MARK_PANE, 640]].forEach(([name, z]) => {
    if (!state.map.getPane(name)) state.map.createPane(name).style.zIndex = String(z);
  });
  buildForm(pane);
  wireMapPicking();
}

// Para pruebas y para enlazar desde otras partes (p. ej. "Ir desde aquí")
export function setTripEnds(from, to){
  if (from) ends.from = from;
  if (to) ends.to = to;
  ['from', 'to'].forEach(k => { removePin(k); addPin(k); });
  syncInputs();
  return replan();
}
