// recents.js
// Panel "Rutas recientes": las últimas rutas que el usuario marcó una a una
// (en la lista o desde el buscador), para volver a marcarlas o desmarcarlas
// rápido. Las casillas de grupo no agregan rutas aquí.
import { $, el } from './utils.js';

const MAX_RECENTS = 8;
const STORAGE_KEY = 'limarutas.recents';

const SYSTEM_LABELS = {
  met: 'Metropolitano',
  alim: 'Alimentador',
  corr: 'Corredor',
  metro: 'Metro',
  wr: 'Transporte público',
  wrSemi: 'Transporte semiformal',
  wrAero: 'AeroDirecto',
  wrOtros: 'Expreso San Isidro'
};

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

function makeRow(entry, leaf){
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

  const btnRemove = el('button', {
    type: 'button',
    class: 'recent-remove',
    title: 'Quitar de recientes',
    'aria-label': `Quitar ${name} de recientes`
  }, '×');
  btnRemove.addEventListener('click', () => {
    recents = recents.filter(e => !(e.system === entry.system && e.id === entry.id));
    save();
    renderRecents();
  });

  const head = el('label', { class: 'recent-row item-head', title: SYSTEM_LABELS[entry.system] || '' },
    cloneLeft(item, entry), chk);

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
  for (const entry of recents){
    const leaf = findLeaf(entry);
    if (leaf) list.appendChild(makeRow(entry, leaf));
  }
  panel.hidden = !list.children.length;
}

// Refleja en el panel el estado actual de las casillas originales
export function refreshRecents(){
  const list = $('#p-recent-list');
  if (!list || !recents.length) return;
  list.querySelectorAll('.recent-item').forEach(syncRow);
}

export function addRecent(leaf){
  const system = leaf.dataset.system;
  const id = leaf.dataset.id;
  if (!system || !id) return;

  const idx = recents.findIndex(e => e.system === system && e.id === id);
  if (idx === 0) return;
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
    btnClear.addEventListener('click', () => {
      recents = [];
      save();
      renderRecents();
    });
  }
}
