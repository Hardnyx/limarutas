// routeInspector.js
// Panel "Rutas en este punto": muestra como chips de color todas las líneas
// que pasan bajo el cursor (no solo la de arriba) y, al pasar sobre un chip,
// su detalle, resaltando esa ruta en el mapa.
//
// - Mouse: se actualiza cuando el cursor se detiene (~150 ms).
// - Clic en el mapa: fija el panel en ese punto (o lo cierra si no hay rutas).
//   En pantallas táctiles es la única forma de abrirlo.
// - showStopRoutes(): abre el panel con las rutas que paran en un paradero
//   (desde el buscador), aunque no estén dibujadas.
import { state } from './config.js';
import { $, el } from './utils.js';
import { addRecent } from './recents.js';
import { bulk, setLeafChecked, syncAllTri } from './uiSidebar.hierarchy.js';
import { isOverStop } from './stopHover.js';

const TOLERANCE_PX = 6;
// El hover abre el panel solo con rutas superpuestas; con una sola no aporta
const HOVER_MIN_ROUTES = 2;

// Listas del sidebar con rutas de Wikiroutes, en orden de preferencia
const WR_SYSTEMS = ['wr', 'corr', 'wrAero', 'wrOtros', 'wrSemi'];
const HOVER_DELAY_MS = 150;

const SYSTEM_LABELS = {
  wr: 'Transporte público',
  wrSemi: 'Transporte semiformal',
  wrAero: 'AeroDirecto',
  wrOtros: 'Expreso San Isidro',
  corr: 'Corredor',
  met: 'Metropolitano',
  alim: 'Alimentador',
  metro: 'Metro'
};

/* =========================
   Detección de líneas bajo el cursor
   ========================= */

function polylinesOf(layer, out = []){
  if (!layer) return out;
  if (layer instanceof L.Polyline) out.push(layer);
  else if (typeof layer.eachLayer === 'function') layer.eachLayer(l => polylinesOf(l, out));
  return out;
}

// Distancia en px del punto a la polilínea ya proyectada por Leaflet (_parts)
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

// Índice de las casillas del sidebar (se arma una vez: la lista no cambia)
let leafIndex = null;
function leaves(){
  if (!leafIndex){
    leafIndex = new Map();
    document.querySelectorAll('#panels .item .item-head input[type="checkbox"][data-system]').forEach(chk => {
      const { system, id, ida, vuelta } = chk.dataset;
      if (ida && !leafIndex.has(`pair:${ida}`)) leafIndex.set(`pair:${ida}`, chk);
      if (vuelta && !leafIndex.has(`pair:${vuelta}`)) leafIndex.set(`pair:${vuelta}`, chk);
      if (id && !leafIndex.has(`${system}:${id}`)) leafIndex.set(`${system}:${id}`, chk);
    });
  }
  return leafIndex;
}

// Ítem del sidebar de una subcapa WR ("1002-ida", "AD-N-vuelta", ...)
function wrLeafFor(subId){
  const idx = leaves();
  const byPair = idx.get(`pair:${subId}`);
  if (byPair) return byPair;
  // Por código solo dentro de listas de Wikiroutes: "6" no es el Expreso 6
  const base = String(subId).replace(/-(ida|vuelta)$/i, '');
  for (const sys of WR_SYSTEMS){
    const leaf = idx.get(`${sys}:${base}`);
    if (leaf) return leaf;
  }
  return null;
}

function wrEntry(subId, polys){
  const leaf = wrLeafFor(subId);
  const item = leaf?.closest('.item');
  const tag = item?.querySelector('.item-head .left .tag');
  const title = item?.querySelector('.item-head .name')?.textContent?.trim() || '';

  // Distritos (dicen más que un paradero); si no hay, los paraderos extremos
  const dist = item?.querySelector('.wr-subtitle-dist')?.textContent?.trim();
  const subs = item ? item.querySelectorAll('.item-head .sub') : [];
  const route = (item?.querySelector('.wr-subtitle-route')?.textContent
    || subs[subs.length - 1]?.textContent || '').trim();

  return {
    key: `wr:${subId}`,
    code: tag?.textContent?.trim() || String(subId).replace(/-(ida|vuelta)$/i, '').toUpperCase(),
    color: tag?.style.background || polys[0]?.options.color || '#64748b',
    title,
    sub: (dist && dist !== title) ? dist : route,
    system: SYSTEM_LABELS[leaf?.dataset.system] || SYSTEM_LABELS.wr,
    leaf,
    polys
  };
}

function serviceEntry(sysId, id, polys){
  const svc = state.systems[sysId]?.services?.find(s => String(s.id) === String(id));
  const leaf = leaves().get(`${sysId}:${id}`) || null;
  const code = String(id).toUpperCase();
  return {
    key: `${sysId}:${id}`,
    code,
    color: polys[0]?.options.color || svc?.color || '#64748b',
    title: svc?.name || `${SYSTEM_LABELS[sysId]} ${code}`,
    sub: '',
    system: SYSTEM_LABELS[sysId],
    leaf,
    polys
  };
}

// Subcapas WR (rid "1240-ida", ...) por carpeta de Wikiroutes ("155549")
let ridsByFolder = null;
function ridsForFolder(folderId){
  if (!ridsByFolder){
    ridsByFolder = new Map();
    state.systems.wr.routeDefs?.forEach((def, rid) => {
      const m = String(def.folder || '').match(/route_(\d+)$/);
      if (!m) return;
      if (!ridsByFolder.has(m[1])) ridsByFolder.set(m[1], []);
      ridsByFolder.get(m[1]).push(rid);
    });
  }
  return ridsByFolder.get(String(folderId)) || [];
}

// Una entrada por ítem del sidebar (ida y vuelta comparten ítem)
export function entriesForFolders(folderIds){
  const key = folderIds.join(',');
  const cached = entriesCache.get(key);
  if (cached) return cached.map(e => ({ ...e, polys: currentPolys(e.rid) }));
  const out = buildEntriesForFolders(folderIds);
  entriesCache.set(key, out);
  return out;
}

const entriesCache = new Map();

function currentPolys(rid){
  const group = state.systems.wr.layers?.get(rid);
  return group ? polylinesOf(group) : [];
}

function buildEntriesForFolders(folderIds){
  const byLeaf = new Map();
  for (const fid of folderIds){
    for (const rid of ridsForFolder(fid)){
      const leaf = wrLeafFor(rid);
      if (!leaf || byLeaf.has(leaf)) continue;
      byLeaf.set(leaf, { ...wrEntry(rid, currentPolys(rid)), rid });
    }
  }
  return [...byLeaf.values()].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
}

function findUnderPoint(layerPoint){
  const found = [];

  state.systems.wr.layers?.forEach((group, id) => {
    if (!state.map.hasLayer(group)) return;
    const polys = polylinesOf(group);
    if (polys.some(pl => hits(pl, layerPoint))) found.push(wrEntry(id, polys));
  });

  for (const sysId of ['met', 'alim', 'corr', 'metro']){
    state.systems[sysId]?.lineLayers?.forEach((group, id) => {
      const polys = polylinesOf(group);
      if (polys.some(pl => hits(pl, layerPoint))) found.push(serviceEntry(sysId, id, polys));
    });
  }

  return found.sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
}

// Texto oscuro sobre colores claros (amarillo, verde lima...) para que se lea
function paintTag(tagEl, color){
  tagEl.style.background = color;
  const probe = document.createElement('span');
  probe.style.color = color;
  document.body.appendChild(probe);
  const m = getComputedStyle(probe).color.match(/\d+/g);
  probe.remove();
  if (!m) return;
  const [r, g, b] = m.map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance > 0.62) tagEl.classList.add('on-light');
}

/* =========================
   Resaltado en el mapa
   ========================= */

let highlighted = null;   // { entries, saved: Map(poly -> estilo) }

function clearHighlight(){
  if (!highlighted) return;
  highlighted.saved.forEach((style, poly) => poly.setStyle(style));
  highlighted = null;
}

// Resalta una ruta y atenúa las demás de este punto
function highlight(entries, active){
  clearHighlight();
  const saved = new Map();
  for (const e of entries){
    for (const poly of e.polys){
      if (!poly._map) continue;
      saved.set(poly, { weight: poly.options.weight, opacity: poly.options.opacity });
      if (e === active){
        poly.setStyle({ weight: (poly.options.weight || 5) + 3, opacity: 1 });
        poly.bringToFront();
      } else {
        poly.setStyle({ opacity: 0.15 });
      }
    }
  }
  highlighted = { entries, saved };
}

/* =========================
   Panel
   ========================= */

let api = null;

// Abre el panel con las rutas de un paradero: { name, lat, lon, folderIds }
export function showStopRoutes(stop){
  api?.showStop(stop);
}

export function wireRouteInspector(){
  const map = state.map;
  if (!map) return;

  const count = el('span', { class: 'ri-count' }, '');
  const btnCollapse = el('button', { type: 'button', class: 'ri-btn', title: 'Plegar', 'aria-label': 'Plegar panel' }, '–');
  const btnClose = el('button', { type: 'button', class: 'ri-btn', title: 'Cerrar', 'aria-label': 'Cerrar panel' }, '×');
  const hint = el('div', { class: 'ri-hint' }, '');
  const chips = el('div', { class: 'ri-chips', role: 'list' });
  const detail = el('div', { class: 'ri-detail', 'aria-live': 'polite' });
  const body = el('div', { class: 'ri-body' }, hint, chips, detail);
  const title = el('span', { class: 'ri-title' }, 'Rutas en este punto');
  const panel = el('aside', { class: 'route-inspector', 'aria-label': 'Rutas en este punto', hidden: '' },
    el('div', { class: 'ri-head' }, title, count, btnCollapse, btnClose),
    body);
  document.body.appendChild(panel);

  // La rueda y los clics dentro del panel no deben mover el mapa
  L.DomEvent.disableScrollPropagation(panel);
  L.DomEvent.disableClickPropagation(panel);

  let entries = [];
  let pinned = false;
  let overPanel = false;
  let timer = null;
  let lastKey = '';
  let stopMode = null;      // { name, marker } cuando se abrió desde un paradero

  const hoverCapable = window.matchMedia?.('(hover: hover)').matches ?? true;

  function setHint(){
    hint.innerHTML = '';
    if (stopMode){
      const hidden = entries.filter(e => e.leaf && !e.leaf.checked);
      if (hidden.length){
        const btnAll = el('button', { type: 'button', class: 'btn small' },
          `Mostrar ${hidden.length === entries.length ? 'las' : 'las otras'} ${hidden.length} rutas`);
        btnAll.addEventListener('click', () => {
          bulk(() => hidden.forEach(e => setLeafChecked(e.leaf.dataset.system, e.leaf, true, { silentFit: true })));
          syncAllTri();
          setHint();
        });
        hint.appendChild(btnAll);
      } else {
        hint.textContent = 'Todas las rutas de este paradero están en el mapa';
      }
      panel.classList.add('pinned');
      return;
    }
    hint.textContent = pinned
      ? (hoverCapable ? 'Fijado · clic en otro punto del mapa para cambiar' : 'Toca otro punto del mapa para cambiar')
      : (hoverCapable ? 'Clic en el mapa para fijar' : '');
    panel.classList.toggle('pinned', pinned);
  }

  function showDetail(entry){
    detail.innerHTML = '';
    if (!entry){
      detail.appendChild(el('div', { class: 'ri-placeholder' },
        entries.length > 1
          ? (hoverCapable ? 'Pasa el mouse sobre un código para ver su detalle' : 'Toca un código para ver su detalle')
          : ''));
      return;
    }
    const tag = el('span', { class: 'tag ri-detail-tag' }, entry.code);
    paintTag(tag, entry.color);

    const text = el('div', { class: 'ri-detail-text' });
    if (entry.title) text.appendChild(el('div', { class: 'ri-detail-title' }, entry.title));
    if (entry.sub) text.appendChild(el('div', { class: 'ri-detail-sub' }, entry.sub));
    text.appendChild(el('div', { class: 'ri-detail-sys' }, entry.system));

    const actions = el('div', { class: 'ri-actions' });
    if (entry.leaf){
      const btnRecent = el('button', { type: 'button', class: 'btn small' }, 'Agregar a recientes');
      btnRecent.addEventListener('click', () => {
        addRecent(entry.leaf);
        btnRecent.textContent = 'En recientes ✓';
        btnRecent.disabled = true;
      });
      if (stopMode){
        const btnShow = el('button', { type: 'button', class: 'btn small' },
          entry.leaf.checked ? 'Ocultar' : 'Mostrar');
        btnShow.addEventListener('click', () => {
          entry.leaf.click();
          btnShow.textContent = entry.leaf.checked ? 'Ocultar' : 'Mostrar';
          setHint();
        });
        actions.append(btnShow);
      }
      const btnOnly = el('button', { type: 'button', class: 'btn small btn-ghost' }, 'Ver solo esta');
      btnOnly.addEventListener('click', () => {
        const leaf = entry.leaf;
        clearHighlight();
        $('#btnClearAll')?.click();
        if (!leaf.checked) leaf.click();
        hide();
      });
      actions.append(btnRecent, btnOnly);
    }

    detail.append(el('div', { class: 'ri-detail-head' }, tag, text), actions);
  }

  function render(found){
    const key = found.map(f => f.key).join('|');
    if (key === lastKey && !panel.hidden) return;
    lastKey = key;
    clearHighlight();
    entries = found;

    chips.innerHTML = '';
    for (const entry of entries){
      const chip = el('button', {
        type: 'button',
        class: 'tag ri-chip',
        role: 'listitem',
        title: entry.title || entry.code
      }, entry.code);
      paintTag(chip, entry.color);

      const activate = () => {
        chips.querySelectorAll('.ri-chip.active').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        showDetail(entry);
        highlight(entries, entry);
      };
      chip.addEventListener('mouseenter', activate);
      chip.addEventListener('focus', activate);
      chip.addEventListener('click', activate);
      chips.appendChild(chip);
    }

    count.textContent = `${entries.length}`;
    showDetail(entries.length === 1 ? entries[0] : null);
    setHint();
    panel.hidden = false;
  }

  function leaveStopMode(){
    if (!stopMode) return;
    stopMode.marker?.remove();
    stopMode = null;
    title.textContent = 'Rutas en este punto';
  }

  function hide(){
    clearTimeout(timer);
    clearHighlight();
    leaveStopMode();
    panel.hidden = true;
    pinned = false;
    lastKey = '';
    entries = [];
  }

  // Al salir de los chips se quita el resaltado (el detalle se mantiene)
  chips.addEventListener('mouseleave', clearHighlight);
  panel.addEventListener('mouseenter', () => { overPanel = true; clearTimeout(timer); });
  panel.addEventListener('mouseleave', () => { overPanel = false; clearHighlight(); });

  btnClose.addEventListener('click', hide);
  btnCollapse.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    btnCollapse.textContent = collapsed ? '+' : '–';
    btnCollapse.title = collapsed ? 'Desplegar' : 'Plegar';
    btnCollapse.setAttribute('aria-label', collapsed ? 'Desplegar panel' : 'Plegar panel');
  });

  map.on('mousemove', (e) => {
    if (pinned || overPanel || stopMode) return;
    clearTimeout(timer);
    // Sobre un paradero manda su nombre: el panel se queda como está
    if (isOverStop()) return;
    const p = e.layerPoint;
    timer = setTimeout(() => {
      if (isOverStop()) return;
      const found = findUnderPoint(p);
      if (found.length >= HOVER_MIN_ROUTES) render(found);
      else if (!panel.hidden) hide();
    }, HOVER_DELAY_MS);
  });

  map.getContainer().addEventListener('mouseleave', () => clearTimeout(timer));

  // Clic (o toque): fija el panel con lo que hay en ese punto
  map.on('click', (e) => {
    clearTimeout(timer);
    const found = findUnderPoint(e.layerPoint);
    if (!found.length){ hide(); return; }
    leaveStopMode();
    lastKey = '';
    render(found);
    pinned = true;
    setHint();
  });

  // Al mover o hacer zoom cambian las líneas bajo el punto: se suelta
  map.on('zoomstart', () => { if (!pinned && !stopMode) hide(); else clearHighlight(); });

  api = {
    showStop({ name, lat, lon, folderIds }){
      clearTimeout(timer);
      leaveStopMode();
      const found = entriesForFolders(folderIds);
      if (!found.length) return;

      let marker = null;
      if (lat != null && lon != null){
        marker = L.circleMarker([lat, lon], {
          radius: 9, color: '#fff', weight: 3, fillColor: '#f59e0b', fillOpacity: 1, interactive: false
        }).addTo(map);
        map.setView([lat, lon], Math.max(map.getZoom(), 16));
      }
      stopMode = { name, marker };
      title.textContent = `Paradero ${name}`;
      lastKey = '';
      render(found);
      pinned = true;
      setHint();
    }
  };
}
