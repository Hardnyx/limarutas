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

function makeRow(entry, leaf){
  const item = leaf.closest('.item');
  const icon = item?.querySelector('.item-head .left')?.firstElementChild;
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

  const label = el('label', { class: 'recent-row' },
    icon ? icon.cloneNode(true) : el('span', { class: 'tag' }, entry.id),
    el('span', { class: 'recent-text' },
      el('span', { class: 'recent-name' }, name),
      el('span', { class: 'recent-sub' }, SYSTEM_LABELS[entry.system] || '')
    ),
    chk
  );

  return el('div', { class: 'recent-item' }, label, btnRemove);
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
  list.querySelectorAll('.recent-item').forEach((row, i) => {
    const entry = recents[i];
    const leaf = entry && findLeaf(entry);
    const chk = row.querySelector('input[type="checkbox"]');
    if (leaf && chk) chk.checked = leaf.checked;
  });
}

function addRecent(leaf){
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

  const btnClear = $('#btnClearRecents');
  if (btnClear){
    btnClear.addEventListener('click', () => {
      recents = [];
      save();
      renderRecents();
    });
  }
}
