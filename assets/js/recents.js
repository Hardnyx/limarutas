// recents.js
// Panel "Rutas recientes": las últimas rutas que el usuario marcó una a una
// (en la lista o desde el buscador), para volver a marcarlas o desmarcarlas
// rápido. Las casillas de grupo no agregan rutas aquí.
//
// En la nueva interfaz (betaLayout.js) hay además "En el mapa": el desglose
// de las rutas marcadas ahora, con las mismas filas. Ahí Recientes es el
// historial: solo las que ya no están en el mapa.
import { SYSTEM_LABELS } from './config.js';
import { $, $$, el } from './utils.js';
import { toggleLeaf } from './leafToggle.js';

const MAX_RECENTS = 8;
const STORAGE_KEY = 'limarutas.recents';


let recents = [];          // [{ system, id }], la más reciente primero
let reordering = true;     // false mientras se marca desde el propio panel

function leafSelector(system, id){
  return `#panels .item .item-head input[type="checkbox"][data-system="${system}"][data-id="${CSS.escape(id)}"]`;
}

function findLeaf(entry){
  return document.querySelector(leafSelector(entry.system, entry.id));
}

function save(){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
  } catch {}
}

function load(){
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(raw)) {
      recents = raw
        .filter(e => e && typeof e.system === 'string' && typeof e.id === 'string')
        .slice(0, MAX_RECENTS);
    }
  } catch {
    recents = [];
  }
}

// Copia del bloque de texto del ítem original (título y subtítulos del
// sentido que está seleccionado)
function cloneLeft(item, entry){
  const left = item?.querySelector('.item-head .left');
  if (left) return left.cloneNode(true);
  return el('div', { class: 'left' }, el('span', { class: 'tag' }, entry.id));
}

// Botones de sentido (Ida/Vuelta, N/S...) que accionan los del ítem original
function makeDirControls(item, row){
  const src = item?.querySelector('.dir-mini');
  if (!src) return null;
  const wrap = el('div', { class: 'dir-mini' });
  src.querySelectorAll('.segbtn-mini').forEach(orig => {
    const btn = el('button', {
      type: 'button',
      class: orig.className,
      'data-dir': orig.dataset.dir || '',
      title: orig.title || orig.textContent
    }, orig.textContent);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      orig.click();
      syncRow(row);
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

// Refleja en la fila el estado actual del ítem original
function syncRow(row){
  const leaf = row.__leaf;
  const item = leaf?.closest('.item');
  if (!leaf || !item) return;

  const chk = row.querySelector('.recent-row input[type="checkbox"]');
  if (chk) chk.checked = leaf.checked;

  const left = row.querySelector('.recent-row .left');
  if (left) left.replaceWith(cloneLeft(item, row.__entry));

  const origBtns = item.querySelectorAll('.dir-mini .segbtn-mini');
  row.querySelectorAll('.dir-mini .segbtn-mini').forEach((btn, i) => {
    if (origBtns[i]) btn.className = origBtns[i].className;
  });
}

function makeRow(entry, leaf, { onMap = false } = {}){
  const item = leaf.closest('.item');
  const name = item?.querySelector('.item-head .name')?.textContent || entry.id;

  const chk = el('input', { type: 'checkbox', 'aria-label': `Mostrar ${name}` });
  chk.checked = leaf.checked;
  chk.addEventListener('change', () => {
    // Delegar en la casilla original: dispara su lógica (mapa, zoom, tri-state)
    reordering = false;
    try { if (leaf.checked !== chk.checked) leaf.click(); }
    finally { reordering = true; }
    chk.checked = leaf.checked;
  });

  // Quitar la fila también la quita del mapa: sin la fila, la ruta seguiría
  // dibujada y solo se podría apagar buscándola en su lista
  const btnRemove = el('button', {
    type: 'button',
    class: 'recent-remove',
    title: onMap ? 'Quitar del mapa' : 'Quitar de recientes y del mapa',
    'aria-label': onMap ? `Quitar ${name} del mapa` : `Quitar ${name} de recientes y del mapa`
  }, '×');
  btnRemove.addEventListener('click', () => {
    if (leaf.checked){
      reordering = false;
      try { leaf.click(); } finally { reordering = true; }
    }
    // En "En el mapa", × la quita del mapa y pasa al historial
    if (onMap) return;
    recents = recents.filter(e => !(e.system === entry.system && e.id === entry.id));
    save();
    renderRecents();
  });

  // En "En el mapa" no hace falta la casilla (todas están marcadas): tocar la
  // fila lleva el mapa a la ruta
  const head = onMap
    ? el('button', { type: 'button', class: 'recent-row item-head on-map-go', title: `Ir a ${name} en el mapa` },
      cloneLeft(item, entry))
    : el('label', { class: 'recent-row item-head', title: SYSTEM_LABELS[entry.system] || '' },
      cloneLeft(item, entry), chk);
  if (onMap) head.addEventListener('click', () => toggleLeaf(leaf, true, { fit: true }));

  const row = el('div', { class: 'recent-item' },
    el('div', { class: 'recent-top' }, head, btnRemove));
  row.__leaf = leaf;
  row.__entry = entry;

  const dir = makeDirControls(item, row);
  if (dir) row.appendChild(dir);
  return row;
}

export function renderRecents(){
  const panel = $('#p-recent');
  const list = $('#p-recent-list');
  if (!panel || !list) return;

  list.innerHTML = '';
  const split = !!$('#onMapList');     // nueva interfaz: las del mapa van en "En el mapa"
  for (const entry of recents){
    const leaf = findLeaf(entry);
    if (leaf && !(split && leaf.checked)) list.appendChild(makeRow(entry, leaf));
  }
  panel.hidden = !list.children.length;
  syncClearButton();
}

// "Limpiar" solo aparece si hay filas que no están en el mapa
function syncClearButton(){
  const btn = $('#btnClearRecents');
  if (btn) btn.hidden = !recents.some(e => findLeaf(e) && !findLeaf(e).checked);
}

/* =========================
   En el mapa (nueva interfaz)
   ========================= */

// Más rutas que esto marcadas de un mismo grupo (todo el Metropolitano, un
// corredor entero): una fila por el grupo
const GROUP_ROW_MIN = 6;
const LEAF = '.item .item-head input[type="checkbox"][data-system][data-id]';

// Las casillas del menú principal (no las copias de Recientes ni de En el mapa)
const mainLeaves = () => $$(`#panels ${LEAF}`).filter(c => !c.closest('#p-recent'));

// Fila de un grupo entero: su nombre, cuántas rutas y × para quitarlas
function groupRow(section, n){
  const head = section.querySelector(':scope > .panel-head');
  const title = head?.querySelector('.title')?.firstChild?.textContent?.trim() || 'Grupo';
  const chk = head?.querySelector(':scope > input[type="checkbox"]');
  const btnRemove = el('button', {
    type: 'button', class: 'recent-remove', title: 'Quitar del mapa', 'aria-label': `Quitar ${title} del mapa`
  }, '×');
  btnRemove.addEventListener('click', () => { if (chk?.checked || chk?.indeterminate) chk.click(); if (chk?.checked) chk.click(); });
  const go = el('button', { type: 'button', class: 'recent-row item-head on-map-go', title: `Ver ${title}` },
    el('div', { class: 'left' }, el('span', { class: 'on-map-group' }, title),
      el('span', { class: 'sub' }, `${n} rutas`)));
  go.addEventListener('click', () => {
    if (!section.classList.contains('open')) head?.click();
    head?.scrollIntoView({ block: 'start' });
  });
  return el('div', { class: 'recent-item on-map-item is-group' }, el('div', { class: 'recent-top' }, go, btnRemove));
}

// Desglose de lo que está en el mapa: una fila por ruta (con su sentido y ×)
// o, si un grupo entero está marcado, una por el grupo
export function renderOnMap(){
  const list = $('#onMapList');
  if (!list) return;
  const on = mainLeaves().filter(c => c.checked);
  const rows = [];
  const done = new Set();
  // Grupos enteros primero (de afuera hacia adentro: Metropolitano antes que
  // sus servicios)
  for (const section of $$('#panels section.panel')){
    if (section.id === 'p-recent') continue;
    const leaves = [...section.querySelectorAll(LEAF)];
    if (leaves.length < GROUP_ROW_MIN || leaves.some(c => !c.checked || done.has(c))) continue;
    leaves.forEach(c => done.add(c));
    rows.push(groupRow(section, leaves.length));
  }
  for (const leaf of on){
    if (done.has(leaf)) continue;
    const entry = { system: leaf.dataset.system, id: leaf.dataset.id };
    rows.push(Object.assign(makeRow(entry, leaf, { onMap: true }), { className: 'recent-item on-map-item' }));
  }
  list.replaceChildren(...rows);
}

// Tras cualquier cambio de casillas: el desglose y el historial
export function refreshOnMap(){
  if (!$('#onMapList')) return;
  renderOnMap();
  renderRecents();
}

// Refleja en el panel el estado actual de las casillas originales
export function refreshRecents(){
  const list = $('#p-recent-list');
  if (!list || !recents.length) return;
  list.querySelectorAll('.recent-item').forEach(syncRow);
  syncClearButton();
}

export function addRecent(leaf){
  const system = leaf.dataset.system;
  const id = leaf.dataset.id;
  if (!system || !id) return;

  const idx = recents.findIndex(e => e.system === system && e.id === id);
  // Ya es la primera: solo reflejar su casilla (pudo cambiar sin evento, p. ej. al limpiar el mapa)
  if (idx === 0){ refreshRecents(); return; }
  if (idx > 0) recents.splice(idx, 1);
  recents.unshift({ system, id });
  recents = recents.slice(0, MAX_RECENTS);
  save();
  renderRecents();
}

export function wireRecents(){
  const panels = $('#panels');
  if (!panels) return;

  load();
  renderRecents();

  // Solo cambios hechos por el usuario (clic o buscador) disparan 'change';
  // las casillas de grupo cambian las hojas sin eventos.
  panels.addEventListener('change', (e) => {
    const leaf = e.target;
    if (!(leaf instanceof HTMLInputElement)) return;
    if (!leaf.matches('.item .item-head input[type="checkbox"][data-system][data-id]')) return;
    if (leaf.closest('#p-recent')) return;

    if (leaf.checked && reordering) addRecent(leaf);
    else refreshRecents();
  });

  // Si se cambia el sentido en el menú principal, se refleja aquí
  panels.addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-mini .segbtn-mini');
    if (!btn || btn.closest('#p-recent')) return;
    setTimeout(refreshRecents, 0);
  });

  const btnClear = $('#btnClearRecents');
  if (btnClear){
    // Limpia el historial: las rutas que están en el mapa se quedan (son su
    // forma de apagarlas); para quitarlas del mapa está "Limpiar" de En el mapa
    btnClear.addEventListener('click', () => {
      recents = recents.filter(e => findLeaf(e)?.checked);
      save();
      renderRecents();
    });
  }
}
