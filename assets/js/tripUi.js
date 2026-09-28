// tripUi.js
// Pestaña "Cómo llegar" (nueva interfaz): origen y destino (paradero o punto
// en el mapa), opciones de viaje (tripPlanner.js) y su dibujo en el mapa.
import { state } from './config.js';
import { $, el } from './utils.js';
import { loadTripGraph } from './tripData.js';
import { planTrip, oldWouldHelp, offHoursHelp } from './tripPlanner.js';
import { limaTime, scheduleText, nextStart, DAY_NAMES } from './metSchedule.js';
import { fitTo } from './mapFit.js';
import { getMetMacroId } from './mapLayers.js';
import { paintTag, TRIP_END_EVENT } from './routeInspector.js';
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
    if (!items.length && input.value.trim()){
      list.appendChild(el('div', { class: 'suggest-empty' },
        'Ningún paradero con ese nombre. Prueba con otra palabra o usa 📍 para elegirlo en el mapa.'));
      list.classList.add('open');
      return;
    }
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
    syncUrl();
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
  clear.addEventListener('click', () => { input.value = ''; ends[end] = null; removePin(end); clearResults(); syncUrl(); close(); input.focus(); });
  pick.addEventListener('click', () => startPicking(end));
  return wrap;
}

// Hora de salida (Lima): "Ahora" o un día y hora. El Metropolitano tiene
// horarios; el resto se asume en servicio a cualquier hora.
function departure(){
  const day = $('#tripDay')?.value;
  if (!day || day === 'now') return limaTime();
  const [h, m] = ($('#tripTime').value || '08:00').split(':').map(Number);
  return { day: Number(day), min: h * 60 + m };
}

function whenRow(){
  const now = limaTime();
  // De lunes a domingo
  const days = [1, 2, 3, 4, 5, 6, 0].map(d => el('option', { value: String(d) }, DAY_NAMES[d]));
  const nowOpt = el('option', { value: 'now' }, 'Ahora');
  const daySel = el('select', { id: 'tripDay', 'aria-label': 'Día de salida' }, nowOpt, ...days);
  // "Ahora (8:05)": la hora que se usa, al día cuando se abre la lista
  const refreshNow = () => {
    const n = limaTime();
    nowOpt.textContent = `Ahora (${Math.floor(n.min / 60)}:${String(n.min % 60).padStart(2, '0')})`;
  };
  refreshNow();
  daySel.addEventListener('focus', refreshNow);
  daySel.addEventListener('pointerdown', refreshNow);
  const hh = String(Math.floor(now.min / 60)).padStart(2, '0');
  const mm = String(now.min % 60).padStart(2, '0');
  const time = el('input', { type: 'time', id: 'tripTime', value: `${hh}:${mm}`, 'aria-label': 'Hora de salida', hidden: '' });
  daySel.addEventListener('change', () => { time.hidden = daySel.value === 'now'; void replan(); });
  time.addEventListener('change', () => { void replan(); });
  return el('label', { class: 'trip-opt trip-when', title: 'Día y hora de salida' },
    el('span', { class: 'trip-opt-ico', 'aria-hidden': 'true' }, '🕒'), daySel, time);
}

function buildForm(pane){
  pane.innerHTML = '';
  const oldChk = el('input', { type: 'checkbox', id: 'tripOld' });
  // En el celular, con resultados, el formulario se resume en una línea que
  // se toca para editar (así se ven más opciones)
  const summary = el('button', { type: 'button', class: 'trip-summary', 'aria-label': 'Editar origen, destino y salida' },
    el('span', { class: 'trip-summary-text' }), el('span', { class: 'trip-summary-edit' }, 'Editar'));
  summary.addEventListener('click', () => setCompact(false));
  pane.append(summary,
    el('div', { class: 'trip-form' },
      field('from', 'A', 'Origen: paradero o 📍 en el mapa'),
      field('to', 'B', 'Destino: paradero o 📍 en el mapa'),
      // Opciones en una fila de chips: salida, invertir, rutas antiguas
      el('div', { class: 'trip-opts' },
        whenRow(),
        el('button', { type: 'button', id: 'tripSwap', class: 'trip-opt trip-opt-icon', title: 'Invertir origen y destino', 'aria-label': 'Invertir origen y destino' }, '⇅'),
        el('label', { class: 'trip-opt trip-old', title: 'Incluir rutas sin autorización de la ATU; podrían ya no circular' }, oldChk, 'Rutas antiguas'))),
    el('div', { id: 'tripStatus', class: 'muted trip-status', role: 'status' }),
    el('div', { id: 'tripResults', class: 'trip-results' }),
    // Se ve mientras no hay resultados (CSS: #tripResults:empty + .trip-help)
    el('div', { class: 'trip-help' },
      el('p', {}, 'Escribe el nombre de un paradero en A y B, o toca 📍 y elige el punto en el mapa.'),
      el('p', {}, 'También puedes abrir un paradero en el mapa y usar "Salir de aquí" o "Llegar aquí".'),
      el('p', {}, 'Con "Salida" eliges el día y la hora: los expresos del Metropolitano solo circulan en ciertos horarios.')));

  oldChk.addEventListener('change', () => { void replan(); });
  $('#tripSwap').addEventListener('click', () => {
    [ends.from, ends.to] = [ends.to, ends.from];
    ['from', 'to'].forEach(k => { removePin(k); if (ends[k]) addPin(k); });
    syncInputs();
    void replan();
  });
}

function setCompact(on){
  const pane = $('#tripPane');
  if (!pane) return;
  const compact = on && document.documentElement.classList.contains('sheet') && !!(ends.from && ends.to);
  pane.classList.toggle('trip-compact', compact);
  if (compact){
    const day = $('#tripDay');
    const when = day?.value === 'now' ? 'Ahora' : `${day?.selectedOptions[0]?.textContent} ${$('#tripTime').value}`;
    $('.trip-summary-text').textContent = `${ends.from.label} → ${ends.to.label} · ${when}`;
  }
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
  return near ? `Cerca de ${graph.stops.name[near[0]]}` : 'Punto en el mapa';
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
  const near = graph.nearestStops(lat, lon, Math.min(SNAP_MAX_M, SNAP_PX * mPerPx))[0];
  if (near){
    const i = near[0];
    const { name, district } = graph.stops;
    return { lat: graph.stops.lat[i], lon: graph.stops.lon[i], label: [name[i], district[i]].filter(Boolean).join(' · ') };
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

function addPin(end){
  const p = ends[end];
  if (!p) return;
  const icon = L.divIcon({ className: `trip-pin trip-pin-${end}`, html: end === 'from' ? 'A' : 'B', iconSize: [28, 28], iconAnchor: [14, 14] });
  const m = L.marker([p.lat, p.lon], { icon, draggable: true, pane: MARK_PANE, keyboard: false, title: end === 'from' ? 'Origen' : 'Destino' }).addTo(state.map);
  m.on('dragend', async () => {
    const ll = m.getLatLng();
    ends[end] = await pickedPoint(ll.lat, ll.lng);
    m.setLatLng([ends[end].lat, ends[end].lon]);
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
  if (route.group === 'alimentador'){
    const m = route.key.match(/^alim:(.+):(ida|vuelta)$/);
    const to = m && state.systems.alim.paths?.[m[1]]?.[m[2]]?.to;
    return `Alimentador ${route.code}${to ? ` · hacia ${to}` : ''}`;
  }
  if (route.group === 'metro') return `Metro de Lima · ${name.replace(/^Línea\s+L/i, 'Línea ') || route.code}`;
  if (name && name !== route.code) return titleCase(name);
  const m = item?.__wrMeta;
  const known = titleCase([m?.empresa_operadora, m?.alias].filter(Boolean).join(' · '));
  return known || (route.group === 'antigua' ? 'Ruta antigua' : '');
}

// "HOLDING REAL EXPRESS" → "Holding Real Express" (siglas cortas y "La 6" quedan igual)
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en']);
function titleCase(s){
  if (!s || s !== s.toUpperCase() || !/[A-ZÁÉÍÓÚÑ]{4}/.test(s)) return s;
  return s.toLowerCase().replace(/[a-záéíóúñü]+/g, (w, i) =>
    (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
}

function chip(route){
  const c = el('span', { class: 'tag trip-chip' }, route.code);
  paintTag(c, colorOf(route));
  const name = routeName(route);
  if (name) c.title = name;
  return c;
}

const stopName = i => graph.stops.name[i] || 'paradero';
// Hacia dónde va: el último paradero; en un alimentador, el barrio o la estación
const headsign = r => {
  const m = r.group === 'alimentador' && r.key.match(/^alim:(.+):(ida|vuelta)$/);
  return (m && state.systems.alim.paths?.[m[1]]?.[m[2]]?.to) || stopName(r.stops[r.stops.length - 1]);
};

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
      if (r.schedule){
        text.append(el('div', { class: 'trip-hours' }, `Horario: ${scheduleText(r.schedule)}`));
      }
      // Intervalo de la ficha técnica del PRR (sin horario: todo el día)
      if (r.headway){
        const wait = Math.max(1, Math.round(leg.wait || r.headway / 2));
        text.append(el('div', { class: 'trip-hours' },
          `Pasa cada ~${r.headway} min según la ATU · espera ~${wait} min${alts.length ? ' con cualquiera' : ''}`));
      }
      if (alts.length){
        const also = el('div', { class: 'trip-also' }, 'O la que pase primero: ');
        alts.forEach((a, i) => { if (i) also.append(' '); also.append(chip(a.route)); });
        text.append(also);
      }
      if (r.group === 'antigua'){
        text.append(' ', el('span', { class: 'trip-warn' }, r.verified ? 'Sin autorización ATU' : 'Ruta antigua · podría no circular'));
      }
      steps.push(el('li', { class: 'trip-step trip-step-ride', style: `--c:${colorOf(r)}` },
        el('span', { class: 'trip-step-ico' }, r.group === 'metro' ? '🚇' : '🚌'), text));
    }
  });
  return steps;
}

// Por qué va cada opción donde va: la primera es la recomendada; se marcan
// la más rápida y la de menos caminata si son otras
function badgesOf(options){
  const out = new Map();
  if (!options.length) return out;
  out.set(options[0], 'Recomendada');
  const fastest = options.reduce((a, b) => (b.minutes < a.minutes ? b : a));
  if (!out.has(fastest)) out.set(fastest, 'Más rápida');
  const leastWalk = options.reduce((a, b) => (b.walkM < a.walkM ? b : a));
  if (!out.has(leastWalk) && leastWalk.walkM + 150 < options[0].walkM) out.set(leastWalk, 'Menos caminata');
  return out;
}

let badges = null;
// "45 min", "2 h 16 min"
function fmtDur(min){
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

// Hora de llegada estimada ("12:46") según la Salida
function arrivalText(min){
  const at = departure();
  const t = (at.min + Math.round(min)) % (24 * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Tira del viaje, como en las apps de transporte: 🚶 7 › [1115] o [1116] › 🚶 3
function stripOf(opt){
  const strip = el('div', { class: 'trip-strip' });
  const parts = [];
  const multi = opt.legs.filter(l => l.type === 'ride').length > 1;
  opt.legs.forEach(leg => {
    if (leg.type === 'walk'){
      if (leg.m < 15) return;
      parts.push(el('span', { class: 'trip-seg-walk', title: `Caminar ${fmtM(leg.m)}` },
        el('span', { class: 'trip-walk-ico', 'aria-hidden': 'true' }, '🚶'), String(walkMinOf(leg.m))));
    } else {
      const seg = el('span', { class: 'trip-seg-ride' }, chip(leg.route));
      const alts = (leg.alts || []).map(a => a.route);
      // Con transbordo, las equivalentes solo como "+N" (la tira no entraría en una línea)
      if (alts.length && multi){
        seg.append(el('span', { class: 'trip-plus', title: 'También te sirven:\n' + alts.map(r => `${r.code} ${routeName(r)}`).join('\n') }, `+${alts.length}`));
      } else if (alts.length){
        const c = chip(alts[0]); c.classList.add('trip-chip-sm');
        const or = el('span', { class: 'trip-or-alts', title: 'También te sirven:\n' + alts.map(r => `${r.code} ${routeName(r)}`).join('\n') }, 'o', c);
        if (alts.length > 1) or.append(el('span', { class: 'trip-plus' }, `+${alts.length - 1}`));
        seg.append(or);
      }
      parts.push(seg);
    }
  });
  parts.forEach((p, i) => { if (i) strip.append(el('span', { class: 'trip-sep', 'aria-hidden': 'true' }, '›')); strip.append(p); });
  return strip;
}

function card(opt, k){
  const rides = opt.legs.filter(l => l.type === 'ride');
  const isOpen = k === selected;
  const where = opt.transfers ? `1 transbordo en ${stopName(rides[1].route.stops[rides[1].from])}` : 'Sin transbordo';
  const names = rides.map(l => routeName(l.route)).filter(Boolean).join(', luego ');
  const head = el('div', { class: 'trip-card-head' },
    el('div', { class: 'trip-legs' }, stripOf(opt), el('div', { class: 'trip-name' }, names)),
    el('div', { class: 'trip-time' }, fmtDur(opt.minutes),
      el('small', { class: 'trip-arrive' }, `llegas ~${arrivalText(opt.minutes)}`)));
  const badge = badges?.get(opt);
  const body = el('div', { class: 'trip-card', role: 'button', tabindex: '0', 'aria-expanded': String(isOpen) },
    head, el('div', { class: 'trip-meta' }, badge ? el('span', { class: 'trip-badge' }, badge) : '', `${where} · `,
      el('span', { class: opt.walkM > 1000 ? 'trip-walk-long' : '' }, opt.walkM < 15 ? 'sin caminar' : `${fmtM(opt.walkM)} a pie`)));
  if (opt.old) body.append(el('div', { class: 'trip-warn' }, 'Usa una ruta antigua: podría no circular'));
  if (isOpen){
    body.classList.add('selected');
    const ol = el('ol', { class: 'trip-steps' }, ...stepsOf(opt));
    const show = el('button', { type: 'button', class: 'btn small btn-ghost trip-show' }, 'Ver rutas completas');
    show.title = 'Marca estas rutas y abre la pestaña Rutas';
    show.addEventListener('click', (e) => {
      e.stopPropagation();
      rides.forEach(l => { if (!l.route.leaf.checked) l.route.leaf.click(); });
      $('#tabRoutes')?.click();
    });
    const share = el('button', { type: 'button', class: 'btn small btn-ghost trip-share' }, 'Compartir');
    share.title = 'Copiar el enlace de este viaje';
    share.addEventListener('click', (e) => { e.stopPropagation(); void shareTrip(share); });
    body.append(ol, el('div', { class: 'trip-actions' }, show, share));
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
    if (!$('#tripOld').checked && oldWouldHelp(graph, ends.from, ends.to, { at: departure() })){
      const b = el('button', { type: 'button', class: 'btn small' }, 'Buscar también con rutas antiguas');
      b.addEventListener('click', () => { $('#tripOld').checked = true; void replan(); });
      msg.append(el('div', { class: 'trip-empty-hint' }, 'Hay opciones con rutas antiguas, que podrían ya no circular. ', b));
    }
    offHoursNote(box);
    return;
  }
  badges = badgesOf(last.options);
  setCompact(true);
  last.options.forEach((opt, k) => box.append(card(opt, k)));
  offHoursNote(box);
  box.append(el('div', { class: 'muted trip-note' }, 'Tiempos estimados por distancia; no incluyen la espera del bus.'));
}

// Servicios que servirían pero no circulan a la hora de salida: tocarlos
// cambia la Salida a su próximo horario y recalcula
function offHoursNote(box){
  const at = departure();
  const off = offHoursHelp(graph, ends.from, ends.to, { includeOld: $('#tripOld').checked, at });
  if (!off.length) return;
  const note = el('div', { class: 'trip-offhours' }, 'En otro horario también te sirve:');
  off.forEach(r => {
    const next = nextStart(r.schedule, at);
    const b = el('button', { type: 'button', class: 'trip-offhours-item', title: 'Buscar con esa hora de salida' },
      chip(r), ' ', el('span', { class: 'trip-name' }, routeName(r)),
      el('span', { class: 'trip-sub' }, scheduleText(r.schedule)));
    if (next) b.addEventListener('click', () => setDeparture(next));
    note.append(b);
  });
  box.append(note);
}

// Pone la Salida en { day, min } y recalcula
function setDeparture({ day, min }){
  $('#tripDay').value = String(day);
  const time = $('#tripTime');
  time.value = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  time.hidden = false;
  void replan();
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

// Metropolitano: el tramo por su trazado sobre la vía (metropolitano_paths.json)
// entre la estación de subida y la de bajada; si no está, por la macroruta
function metCoords(r, stops, leg){
  const m = r.key.match(/^met:(.+):(ns|sn)$/);
  const path = m && state.systems.met.paths?.[`${m[1]}:${m[2]}`];
  if (path && path.at.length === r.stops.length){
    return path.coords.slice(path.at[leg.from], path.at[leg.to] + 1);
  }
  const svc = m && state.systems.met.services?.find(x => String(x.id) === m[1]);
  const def = svc && state.systems.met.macros?.[getMetMacroId(svc)];
  const segs = def && def[m[2] === 'ns' ? 'north_south' : 'south_north'];
  if (!segs?.length) return stops;
  const line = segs.flat();
  const TOL = (300 / 111_000) ** 2;
  const [i, di] = nearestIdx(line, stops[0]);
  const [j, dj] = nearestIdx(line, stops[stops.length - 1]);
  if (i < 0 || j < 0 || di > TOL || dj > TOL || i === j) return stops;
  const part = i < j ? line.slice(i, j + 1) : line.slice(j, i + 1).reverse();
  return [stops[0], ...part, stops[stops.length - 1]];
}

function rideCoords(r, leg, pt){
  const stops = Array.from(r.stops.slice(leg.from, leg.to + 1), pt);
  if (r.group === 'metropolitano') return metCoords(r, stops, leg);
  if (r.group === 'alimentador'){
    // Por su trazado entre el paradero de subida y el de bajada
    const m = r.key.match(/^alim:(.+):(ida|vuelta)$/);
    const d = m && state.systems.alim.paths?.[m[1]]?.[m[2]];
    if (d && d.stops.length === r.stops.length) return d.coords.slice(d.stops[leg.from].at, d.stops[leg.to].at + 1);
    return stops;
  }
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
  // Metro, Metropolitano y Alimentadores tienen su propio trazado
  const keys = opt.legs.filter(l => l.type === 'ride' && !/^(met|metro|alim):/.test(l.route.key)).map(l => l.route.key);
  const missing = keys.filter(k => !loadedTracks.has(k));
  if (!missing.length) return;
  const lines = await Promise.all(missing.map(loadTrack));
  // También los que no tienen trazado (null): si no, se volvería a dibujar sin fin
  missing.forEach((k, i) => loadedTracks.set(k, lines[i]));
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
    // Cada paradero del tramo, con su nombre; los de subida y bajada más grandes
    for (let k = leg.from; k <= leg.to; k++){
      const end = k === leg.from || k === leg.to;
      const stop = r.stops[k];
      tripLayer.addLayer(L.circleMarker(pt(stop), {
        // Subida y bajada bien marcadas; las intermedias, discretas (del color de la ruta)
        pane: MARK_PANE, radius: end ? 6.5 : 2.5, color: end ? color : '#fff', weight: end ? 3.5 : 1,
        fillColor: end ? '#fff' : color, fillOpacity: 1, bubblingMouseEvents: false
      }).bindTooltip(end ? `${k === leg.from ? 'Sube' : 'Baja'} en ${stopName(stop)}` : stopName(stop),
        { className: 'stop-tip', direction: 'top', offset: [0, -6] }));
    }
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
  if (!ends.from || !ends.to){ syncUrl(); return; }
  await ensureGraph();
  setStatus('Buscando opciones…');
  // Deja pintar el estado antes del cálculo
  await new Promise(res => setTimeout(res, 0));
  last = planTrip(graph, ends.from, ends.to, { includeOld: $('#tripOld').checked, at: departure() });
  setStatus('');
  syncUrl();
  await renderResults();
  draw();
  if (last.options.length || last.walkOnly) setSheet('half');
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
  [[LINE_PANE, 480], [MARK_PANE, 640]].forEach(([name, z]) => {
    if (!state.map.getPane(name)) state.map.createPane(name).style.zIndex = String(z);
  });
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
