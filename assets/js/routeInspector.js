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
import { confirmManyRoutes } from './stopsGuard.js';
import { findUnderPoint, entriesForFolders } from './routeEntries.js';

// El hover abre el panel solo con rutas superpuestas; con una sola no aporta
const HOVER_MIN_ROUTES = 2;
const HOVER_DELAY_MS = 150;

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

// Cierra el panel (y el marcador del paradero)
export function closeRouteInspector(){
  api?.hide();
}

// Abre el panel con las rutas de un paradero: { name, lat, lon, folderIds, district }
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
        btnAll.addEventListener('click', async () => {
          if (!(await confirmManyRoutes(hidden.length))) return;
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

  // Esc cierra el panel (salvo que haya un diálogo, sugerencias o ajustes
  // del mapa abiertos: ese Esc es para ellos)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    if (document.querySelector('.ui-dialog')) return;
    if (document.querySelector('#searchSuggest.open')) return;
    if (document.querySelector('#mapSettings:not([hidden])')) return;
    hide();
  });

  api = {
    hide,
    showStop({ name, lat, lon, folderIds, district }){
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
      title.textContent = district ? `Paradero ${name} · ${district}` : `Paradero ${name}`;
      lastKey = '';
      render(found);
      pinned = true;
      setHint();
    }
  };
}
