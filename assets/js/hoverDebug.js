// hoverDebug.js — DEPURACIÓN AD HOC (temporal)
// Lista todas las líneas que hay bajo el cursor, no solo la de arriba.
// Para quitarlo: borrar este archivo, su import/llamada en app.js y el
// bloque "Depuración: rutas bajo el cursor" de styles.css.
import { state } from './config.js';
import { el } from './utils.js';
import { wrRouteTooltip } from './routeTooltip.js';

const TOLERANCE_PX = 6;

const SYSTEM_LABELS = {
  met: 'Metropolitano',
  alim: 'Alimentador',
  corr: 'Corredor',
  metro: 'Metro'
};

function polylinesOf(layer, out = []){
  if (!layer) return out;
  if (layer instanceof L.Polyline) out.push(layer);
  else if (typeof layer.eachLayer === 'function') layer.eachLayer(l => polylinesOf(l, out));
  return out;
}

// Distancia en px del punto a la polilínea ya proyectada (_parts)
function hits(poly, p){
  if (!poly._map || !poly._parts || !poly._pxBounds) return false;
  const b = poly._pxBounds;
  if (p.x < b.min.x - TOLERANCE_PX || p.x > b.max.x + TOLERANCE_PX ||
      p.y < b.min.y - TOLERANCE_PX || p.y > b.max.y + TOLERANCE_PX) return false;
  for (const part of poly._parts){
    for (let i = 1; i < part.length; i++){
      if (L.LineUtil.pointToSegmentDistance(p, part[i - 1], part[i]) <= TOLERANCE_PX) return true;
    }
  }
  return false;
}

function findUnderCursor(layerPoint){
  const found = [];

  const wr = state.systems.wr;
  wr.layers?.forEach((group, id) => {
    if (!state.map.hasLayer(group)) return;
    if (polylinesOf(group).some(pl => hits(pl, layerPoint))) found.push({ kind: 'wr', id });
  });

  for (const sysId of Object.keys(SYSTEM_LABELS)){
    const sys = state.systems[sysId];
    sys?.lineLayers?.forEach((group, id) => {
      const polys = polylinesOf(group);
      const hit = polys.find(pl => hits(pl, layerPoint));
      if (hit) found.push({ kind: sysId, id, color: hit.options.color });
    });
  }
  return found;
}

function rowFor(entry){
  if (entry.kind === 'wr') return el('div', { class: 'hover-debug-row' }, wrRouteTooltip(entry.id));
  const tag = el('span', { class: 'tag route-tip-tag' }, String(entry.id).toUpperCase());
  if (entry.color) tag.style.background = entry.color;
  return el('div', { class: 'hover-debug-row' },
    el('div', { class: 'route-tip-body' }, tag,
      el('div', { class: 'route-tip-text' },
        el('div', { class: 'route-tip-title' }, SYSTEM_LABELS[entry.kind]))));
}

export function wireHoverDebug(){
  const map = state.map;
  const container = map.getContainer();

  const count = el('span', { class: 'hover-debug-count' }, '');
  const hint = el('div', { class: 'hover-debug-hint' }, 'Clic en el mapa para fijar la lista');
  const btnClose = el('button', { type: 'button', class: 'recent-remove', title: 'Limpiar' }, '×');
  const list = el('div', { class: 'hover-debug-list' });
  const panel = el('div', { class: 'hover-debug', hidden: '' },
    el('div', { class: 'hover-debug-head' },
      el('span', { class: 'wr-debug-label' }, 'Depuración · bajo el cursor'), count, btnClose),
    hint,
    list);
  document.body.appendChild(panel);

  // Que la rueda y los clics dentro del panel no muevan el mapa
  L.DomEvent.disableScrollPropagation(panel);
  L.DomEvent.disableClickPropagation(panel);

  let pending = null;
  let queued = false;
  let lastKey = '';
  let pinned = false;

  const setPinned = (v) => {
    pinned = v;
    panel.classList.toggle('pinned', v);
    hint.textContent = v
      ? 'Lista fijada · clic en el mapa para soltarla'
      : 'Clic en el mapa para fijar la lista';
  };

  btnClose.addEventListener('click', () => { panel.hidden = true; lastKey = ''; setPinned(false); });

  // Fijar/soltar: permite llevar el mouse al panel sin que cambie la lista
  map.on('click', () => { if (!panel.hidden) setPinned(!pinned); });

  map.on('mousemove', (e) => {
    if (pinned) return;
    pending = e.layerPoint;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const p = pending;
      pending = null;
      if (!p) return;
      const found = findUnderCursor(p);
      // Sin líneas bajo el cursor se conserva la última lista para poder
      // llevar el mouse al panel y desplazarla
      if (!found.length) return;
      const key = found.map(f => `${f.kind}:${f.id}`).join('|');
      if (key === lastKey) return;
      lastKey = key;

      list.innerHTML = '';
      found
        .sort((a, b) => String(a.id).localeCompare(String(b.id), 'es', { numeric: true }))
        .forEach(f => list.appendChild(rowFor(f)));
      count.textContent = `${found.length} ${found.length === 1 ? 'línea' : 'líneas'}`;
      panel.hidden = false;
    });
  });

  container.addEventListener('mouseleave', () => { pending = null; });
}
