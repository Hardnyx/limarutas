// betaLayout.js
// Nueva interfaz (?beta=1). Reutiliza los mismos elementos del index.html
// (mismos id, mismos listeners): solo los reordena y agrega lo nuevo.
//
//   Sidebar: pestañas [Cómo llegar | Rutas]
//     Rutas: buscador · "En el mapa (N)" + Limpiar · Recientes ·
//            secciones por sistema, con cantidad de rutas y subtítulo
//   Mapa: control de ajustes (paraderos, auto-centrar, tema)
import { state } from './config.js';
import { $, $$, el } from './utils.js';
import { FLAGS } from './flags.js';
import { syncAllTri, FILTERED_SEL, ROUTES_CHANGED } from './uiSidebar.hierarchy.js';
import { wireMobileSheet } from './mobileSheet.js';

const LEAF_SEL = '.item .item-head input[type="checkbox"]';

// Orden de las secciones (del transporte más estructurado al menos) y el
// elemento que identifica a cada una
const SECTIONS = [
  { key: 'metro',  sel: '#chk-metro' },
  { key: 'met',    sel: '#chk-met' },
  { key: 'corr',   sel: '#chk-corr' },
  { key: 'wr',     sel: '#chk-wr',     sub: 'Buses con ruta autorizada por la ATU', filter: '#p-wr' },
  { key: 'aero',   sel: '#p-wr-aero' },
  { key: 'otros',  sel: '#p-wr-otros' },
  { key: 'semi',   sel: '#p-wr-semi',  sub: 'Sin autorización vigente de la ATU; algunas podrían ya no circular', filter: '#p-wr-semi-body' }
];

const sectionOf = (sel) => {
  const n = $(sel);
  return n ? (n.matches('section.panel') ? n : n.closest('section.panel')) : null;
};

/* =========================
   Estructura (antes de cargar los datos)
   ========================= */

export function applyBetaLayout(){
  if (!FLAGS.beta) return;
  const sidebar = $('#sidebar');
  const panels = $('#panels');
  if (!sidebar || !panels) return;

  buildTabs(sidebar, panels);
  reorderSections(panels);
  buildMapSettings(panels);
  wireMobileSheet();
}

function buildTabs(sidebar, panels){
  const tabs = el('div', { class: 'side-tabs', role: 'tablist', 'aria-label': 'Modo' });
  const tabTrip = el('button', { type: 'button', class: 'side-tab', id: 'tabTrip', role: 'tab', 'aria-controls': 'tripPane' }, 'Cómo llegar');
  const tabRoutes = el('button', { type: 'button', class: 'side-tab', id: 'tabRoutes', role: 'tab', 'aria-controls': 'routesPane' }, 'Rutas');
  tabs.append(tabTrip, tabRoutes);

  const tripPane = el('div', { class: 'side-pane', id: 'tripPane', role: 'tabpanel', 'aria-labelledby': 'tabTrip' },
    el('div', { class: 'trip-soon' },
      el('div', { class: 'trip-soon-title' }, 'Próximamente'),
      el('div', { class: 'muted' }, 'Elige de dónde sales y a dónde vas, y te mostraremos qué rutas te llevan y dónde tomarlas.'),
      el('div', { class: 'muted' }, 'Mientras tanto, busca una ruta o un paradero en la pestaña Rutas.')));

  const routesPane = el('div', { class: 'side-pane', id: 'routesPane', role: 'tabpanel', 'aria-labelledby': 'tabRoutes' });

  // Buscador: del topbar al sidebar
  const search = $('#topbar .search');
  const btnClearSearch = $('#btnClearSearch');
  if (search){
    if (btnClearSearch){
      btnClearSearch.className = 'search-clear';
      btnClearSearch.textContent = '×';
      btnClearSearch.setAttribute('aria-label', 'Limpiar búsqueda');
      btnClearSearch.title = 'Limpiar búsqueda';
      search.appendChild(btnClearSearch);
    }
    const input = $('#searchInput');
    if (input) input.placeholder = 'Busca una ruta, empresa o paradero';
    routesPane.appendChild(search);
  }

  // "En el mapa (N)" + Limpiar (el mismo #btnClearAll)
  const onMap = el('div', { class: 'on-map', id: 'onMap', hidden: '' },
    el('span', { class: 'on-map-label' }, 'En el mapa'),
    el('span', { class: 'on-map-count', id: 'onMapCount' }, '0'));
  const btnClearAll = $('#btnClearAll');
  if (btnClearAll){
    btnClearAll.textContent = 'Limpiar';
    btnClearAll.classList.add('small');
    btnClearAll.title = 'Quitar todas las rutas del mapa';
    onMap.appendChild(btnClearAll);
  }
  routesPane.append(onMap, panels);

  const header = sidebar.querySelector('.header');
  (header || sidebar.firstChild).after(tabs, tripPane, routesPane);
  $('#topbar')?.remove();

  const select = (tab) => {
    const isTrip = tab === 'trip';
    tabTrip.setAttribute('aria-selected', String(isTrip));
    tabRoutes.setAttribute('aria-selected', String(!isTrip));
    tabTrip.tabIndex = isTrip ? 0 : -1;
    tabRoutes.tabIndex = isTrip ? -1 : 0;
    tripPane.hidden = !isTrip;
    routesPane.hidden = isTrip;
  };
  tabTrip.addEventListener('click', () => select('trip'));
  tabRoutes.addEventListener('click', () => select('routes'));
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = e.target === tabTrip ? tabRoutes : tabTrip;
    next.click();
    next.focus();
  });
  // Mientras "Cómo llegar" no exista, se abre en Rutas
  select('routes');
}

function reorderSections(panels){
  SECTIONS.forEach(({ sel, sub }) => {
    const section = sectionOf(sel);
    if (!section) return;
    panels.appendChild(section);

    const head = section.querySelector(':scope > .panel-head');
    const title = head && head.querySelector('.title');
    if (!head || !title) return;
    if (sub) title.appendChild(el('span', { class: 'panel-sub' }, sub));
    const count = el('span', { class: 'panel-count' });
    head.insertBefore(count, head.querySelector(':scope > input'));
  });
}

/* =========================
   Ajustes del mapa (control de Leaflet)
   ========================= */

function buildMapSettings(panels){
  const optsSection = $('#chkStops')?.closest('section.panel');
  if (!optsSection || !state.map) return;
  const groups = Array.from(optsSection.querySelectorAll('.group'));
  const status = $('#status');

  const Settings = L.Control.extend({
    options: { position: 'topright' },
    onAdd(){
      const box = el('div', { class: 'leaflet-control map-settings' });
      const btn = el('button', {
        type: 'button', id: 'btnMapSettings', class: 'map-settings-btn',
        'aria-expanded': 'false', 'aria-controls': 'mapSettings',
        'aria-label': 'Ajustes del mapa', title: 'Ajustes del mapa'
      }, '⚙');
      const pop = el('div', { id: 'mapSettings', class: 'map-settings-panel', role: 'dialog', 'aria-label': 'Ajustes del mapa', hidden: '' },
        el('div', { class: 'map-settings-title' }, 'Ajustes del mapa'), ...groups);
      box.append(btn, pop);
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);

      const setOpen = (open) => {
        pop.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
      };
      btn.addEventListener('click', () => setOpen(pop.hidden));
      // Clic fuera o Esc lo cierran
      document.addEventListener('pointerdown', (e) => {
        if (!pop.hidden && !box.contains(e.target)) setOpen(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || pop.hidden || document.querySelector('.ui-dialog')) return;
        setOpen(false);
        btn.focus();
      });
      return box;
    }
  });
  new Settings().addTo(state.map);

  // #status se conserva (fuera de la vista) para quien lo lea: pruebas, lectores de pantalla
  if (status){
    status.classList.add('sr-only');
    status.setAttribute('role', 'status');
    document.body.appendChild(status);
  }
  optsSection.remove();
}

/* =========================
   Contenido (después de construir las listas)
   ========================= */

export function finishBetaLayout(){
  if (!FLAGS.beta) return;
  const panels = $('#panels');
  if (!panels) return;

  SECTIONS.forEach(({ sel, filter }) => {
    if (filter) addListFilter(sectionOf(sel), $(filter));
  });

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; updateCounts(); }, 0);
  };
  panels.addEventListener('change', schedule);
  document.addEventListener(ROUTES_CHANGED, schedule);
  // Corredores se reconstruye al cargar sus tipos
  const corrList = $('#p-corr-list');
  if (corrList) new MutationObserver(schedule).observe(corrList, { childList: true });
  updateCounts();
}

const mainLeaves = () => $$(`#panels ${LEAF_SEL}`).filter(c => !c.closest('#p-recent'));

function updateCounts(){
  const n = mainLeaves().filter(c => c.checked).length;
  const onMap = $('#onMap');
  if (onMap){
    onMap.hidden = n === 0;
    $('#onMapCount').textContent = String(n);
  }

  SECTIONS.forEach(({ sel }) => {
    const section = sectionOf(sel);
    const count = section && section.querySelector(':scope > .panel-head .panel-count');
    if (!count) return;
    const leaves = section.querySelectorAll(LEAF_SEL);
    const on = Array.from(leaves).filter(c => c.checked).length;
    count.textContent = on ? `${on}/${leaves.length}` : String(leaves.length);
    count.classList.toggle('has-on', on > 0);
  });
}

/* =========================
   Filtro de texto de listas largas
   ========================= */

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function addListFilter(section, list){
  if (!section || !list) return;
  const body = list.closest('.panel-body') || list;
  const total = list.querySelectorAll(LEAF_SEL).length;
  const input = el('input', {
    type: 'search', class: 'list-filter',
    placeholder: `Filtrar ${total} rutas: código, empresa, distrito…`,
    'aria-label': 'Filtrar rutas de esta sección'
  });
  const empty = el('div', { class: 'muted list-filter-empty', hidden: '' }, 'Ninguna ruta coincide.');
  body.prepend(input, empty);

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => applyListFilter(list, input.value, empty), 120);
  });
  // Esc limpia el filtro sin cerrar otras cosas
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !input.value) return;
    e.stopPropagation();
    input.value = '';
    applyListFilter(list, '', empty);
  });
}

// Lo visible de la fila y los datos de la lista maestra (empresa, sigla,
// alias, código antiguo)
function filterTextOf(item){
  const m = item.__wrMeta || {};
  return norm([item.textContent, m.empresa_operadora, m.empresa_abrev, m.alias, m.codigo_antiguo].join(' '));
}

// Oculta las rutas que no contienen todas las palabras. Las ocultas no se
// desmarcan (siguen en el mapa); la casilla del grupo solo afecta a las visibles.
function applyListFilter(list, text, empty){
  const words = norm(text).split(/\s+/).filter(Boolean);
  let shown = 0;
  list.querySelectorAll('.item').forEach(item => {
    if (item.__filterText == null) item.__filterText = filterTextOf(item);
    const hide = words.length > 0 && !words.every(w => item.__filterText.includes(w));
    item.classList.toggle('is-text-filtered', hide);
    if (!hide && !item.closest(FILTERED_SEL)) shown++;
  });
  empty.hidden = shown > 0 || !words.length;
  syncAllTri();
}
