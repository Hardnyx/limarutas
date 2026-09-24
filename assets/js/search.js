// search.js
import { PATHS, state } from './config.js';
import { $, el, splitCsvLine } from './utils.js';

function norm(text){
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractSiglas(empresa){
  if (!empresa) return '';
  const m = String(empresa).match(/\(([^()]+)\)\s*\)?$/);
  return m ? m[1].trim() : '';
}

const ALIAS_PLACEHOLDERS = new Set(['ninguno', 'ninguna', 'desconocido', 'desconocida', '?', '¿?', '-', 'sin nombre']);

function cleanAlias(text){
  const s = String(text || '').trim();
  return ALIAS_PLACEHOLDERS.has(s.toLowerCase()) ? '' : s;
}

let listaPromise = null;

async function loadListaRutas(){
  if (listaPromise) return listaPromise;

  async function tryFetch(url){
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const txt = await resp.text();
      return parseListaCsv(txt);
    } catch (e) {
      console.warn('[search] No se pudo leer', url, e.message);
      return null;
    }
  }

  listaPromise = (async () => {
    const direct = await tryFetch('pipeline/output/lista_rutas_maestro.csv');
    if (direct && direct.length) return direct;
    const alt = await tryFetch(`${PATHS.data}/pipeline/output/lista_rutas_maestro.csv`);
    if (alt && alt.length) return alt;
    return [];
  })();

  return listaPromise;
}

function parseListaCsv(text){
  const lines = text.split(/[\r\n]+/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map(h => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++){
    const row = lines[i];
    if (!row.trim()) continue;
    const cols = splitCsvLine(row);
    const obj = {};
    header.forEach((h, idx) => { obj[h] = (cols[idx] || '').trim(); });
    out.push(obj);
  }
  return out;
}

function typeLabel(doc){
  switch (doc.type){
    case 'metro':   return 'Metro de Lima';
    case 'met':     return 'Metropolitano';
    case 'alim':    return 'Alimentadores';
    case 'corr':    return 'Corredores';
    case 'wrAero':  return 'AeroDirecto';
    case 'wrOtros': return 'Expreso San Isidro';
    case 'wrSemi':  return 'Transporte semiformal';
    case 'wr':      return 'Transporte público';
    default:        return '';
  }
}

// Prioridad numérica por tipo: menor = antes en resultados
const TYPE_PRIORITY = {
  metro:   0,
  met:     1,
  alim:    2,
  corr:    3,
  wrAero:  4,
  wrOtros: 5,
  wr:      6,
  wrSemi:  7
};

/* =========================
   Icono del resultado
   ========================= */

function makeIcon(doc){
  const wrap = el('div', { class: 's-ico' });

  if (doc.type === 'metro' || doc.type === 'met'){
    const folder = doc.type === 'metro' ? 'metro' : 'metropolitano';
    const iconId = doc.type === 'metro' ? String(doc.id).replace(/^L/i, '') : doc.id;
    const img = el('img', {
      src: `assets/icons/${folder}/${iconId}.png`,
      alt: doc.id,
      loading: 'lazy'
    });
    img.onerror = () => {
      wrap.removeChild(img);
      wrap.textContent = String(doc.id).toUpperCase();
    };
    wrap.appendChild(img);
    wrap.style.background = 'transparent';
    wrap.style.border = 'none';
    return wrap;
  }

  // Tag coloreado para el resto
  const color = doc.color || '#64748b';
  const label = doc.display_id || String(doc.id).toUpperCase();
  wrap.textContent = label;
  wrap.style.background = color;
  wrap.style.border = 'none';
  wrap.style.color = '#fff';
  wrap.style.fontSize = label.length > 4 ? '9px' : '11px';
  wrap.style.minWidth = '36px';
  wrap.style.padding = '0 5px';
  wrap.style.borderRadius = '999px';
  return wrap;
}

/* =========================
   Índice de búsqueda
   ========================= */

async function buildSearchIndex(){
  if (Array.isArray(state._searchIndex) && state._searchIndex.length){
    return state._searchIndex;
  }

  const docs = [];

  // Metro
  const metroSvcs = (state.systems.metro && state.systems.metro.services) || [];
  for (const svc of metroSvcs){
    if (!svc) continue;
    const id = String(svc.id);
    const name = svc.name || '';
    const lineNum = id.replace(/^L/i, '');
    const label = name ? `Línea ${lineNum} · ${name}` : `Línea ${lineNum} · Metro de Lima`;
    const tokens = norm([id, name, 'metro', 'tren electrico'].join(' '));
    docs.push({ key: `metro:${id}`, system: 'metro', id, label, type: 'metro', tokens });
  }

  // Metropolitano
  const metSvcs = (state.systems.met && state.systems.met.services) || [];
  for (const svc of metSvcs){
    if (!svc) continue;
    const id = String(svc.id);
    const name = svc.name || '';
    const kind = svc.kind || '';
    const kindLabel =
      kind === 'expreso' ? 'Expreso' :
      kind === 'regular' ? 'Ruta regular' : kind;
    const mainLabel = name || `Servicio ${id}`;
    const prefix = kindLabel === 'Expreso' ? `Metropolitano · Expreso ${id}` :
                  kindLabel === 'Ruta regular' ? `Metropolitano · Ruta ${id}` :
                  `Metropolitano · ${id}`;
    const label = prefix;
    const tokens = norm([id, name, kindLabel, 'metropolitano', 'troncal'].join(' '));
    docs.push({ key: `met:${id}`, system: 'met', id, label, type: 'met', tokens });
  }

  // Alimentadores
  const alimSvcs = (state.systems.alim && state.systems.alim.services) || [];
  for (const svc of alimSvcs){
    if (!svc) continue;
    const id = String(svc.id);
    const name = svc.name || '';
    const zone = svc.zone || '';
    const mainLabel = name || `Alimentador ${id}`;
    const label = zone
      ? `Alimentador ${id} · ${mainLabel} (${zone})`
      : `Alimentador ${id} · ${mainLabel}`;
    const tokens = norm([id, name, zone, 'alimentador', 'metropolitano'].join(' '));
    docs.push({ key: `alim:${id}`, system: 'alim', id, label, type: 'alim', tokens });
  }

  // Corredores
  const corrSvcs = (state.systems.corr && state.systems.corr.services) || [];
  for (const svc of corrSvcs){
    if (!svc) continue;
    const id = String(svc.id);
    const name = svc.name || '';
    const op = svc.op || svc.operator || svc.company || '';
    const color = svc.color || null;
    const label = op ? `${id} · ${name} (${op})` : `${id} · ${name || 'Corredor'}`;
    const tokens = norm([id, name, op, 'corredor'].join(' '));
    docs.push({ key: `corr:${id}`, system: 'corr', id, label, type: 'corr', tokens, color });
  }

  // AeroDirecto (wrAero)
  const wrUiFull = (state.systems.wr && state.systems.wr.routesUi) || [];
  const catalogAero = new Set(
    ((state.catalog && state.catalog.aerodirecto && state.catalog.aerodirecto.only) || [])
      .map(x => String(x))
  );
  for (const rt of wrUiFull){
    if (!rt) continue;
    const idStr = String(rt.id);
    if (!catalogAero.has(idStr)) continue;
    const label = rt.name || `AeroDirecto ${idStr}`;
    const tokens = norm([idStr, label, 'aerodirecto', 'aeropuerto'].join(' '));
    docs.push({
      key: `wrAero:${idStr}`,
      system: 'wrAero',
      id: rt.id,
      label,
      type: 'wrAero',
      tokens,
      color: rt.color || null,
      display_id: rt.display_id || null
    });
  }

  // Expreso San Isidro (wrOtros)
  const catalogEsi = new Set(
    ((state.catalog && state.catalog.otros &&
      state.catalog.otros.expreso_san_isidro &&
      state.catalog.otros.expreso_san_isidro.only) || [])
      .map(x => String(x))
  );
  for (const rt of wrUiFull){
    if (!rt) continue;
    const idStr = String(rt.id);
    if (!catalogEsi.has(idStr)) continue;
    const label = rt.name || `Expreso San Isidro ${idStr}`;
    const tokens = norm([idStr, label, 'expreso', 'san isidro'].join(' '));
    docs.push({
      key: `wrOtros:${idStr}`,
      system: 'wrOtros',
      id: rt.id,
      label,
      type: 'wrOtros',
      tokens,
      color: rt.color || null,
      display_id: rt.display_id || null
    });
  }

  // Transporte público tradicional (WR general)
  const wrUiTransporte = wrUiFull.filter(rt => {
    if (!rt) return false;
    const idStr = String(rt.id);
    return !catalogAero.has(idStr) && !catalogEsi.has(idStr);
  });

  const lista = await loadListaRutas();
  const byNuevo = new Map();
  for (const row of lista){
    const nuevo = (row.codigo_nuevo || '').trim();
    if (!nuevo) continue;
    byNuevo.set(nuevo, row);
  }

  for (const rt of wrUiTransporte){
    if (!rt) continue;
    const idStr = String(rt.id);
    const base = idStr.split('-')[0];
    const row = byNuevo.get(base);

    const codigoNuevo   = (row && row.codigo_nuevo)   || base;
    const codigoAntiguo = (row && row.codigo_antiguo) || '';
    const alias         = cleanAlias(row && row.alias);
    const empresa       = (row && row.empresa_operadora) || '';
    const siglas        = (row && row.empresa_abrev) || extractSiglas(empresa);
    const empresaCorta  = siglas || empresa;

    let label;
    if (alias && empresaCorta)      label = `${alias} – ${empresaCorta} (${codigoNuevo})`;
    else if (alias)                 label = `${alias} (${codigoNuevo})`;
    else if (empresaCorta)          label = `${codigoNuevo} – ${empresaCorta}`;
    else                            label = rt.name || `Ruta ${codigoNuevo}`;

    const tokens = norm([
      codigoNuevo, codigoAntiguo, alias, empresa, empresaCorta,
      rt.name || '', 'transporte', 'wikiroutes'
    ].join(' '));

    // Las rutas semiformales viven en su propio panel (data-system="wrSemi")
    const semiChk = document.querySelector(
      `#p-wr-semi .item input[type="checkbox"][data-id="${CSS.escape(idStr)}"]`
    );
    const system = semiChk ? 'wrSemi' : 'wr';

    docs.push({
      key: `${system}:${codigoNuevo}`,
      system,
      id: rt.id,
      label,
      type: system,
      tokens,
      color: rt.color || null,
      display_id: rt.display_id || null,
      meta: { codigoNuevo, codigoAntiguo, alias, empresa, siglas: empresaCorta }
    });
  }

  state._searchIndex = docs;
  return docs;
}

/* =========================
   Ranking
   ========================= */

function rankDocs(docs, query){
  const q = norm(query);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const scored = [];
  for (const doc of docs){
    const hay = doc.tokens;
    let ok = true;
    let score = 0;
    for (const w of words){
      const idx = hay.indexOf(w);
      if (idx === -1){ ok = false; break; }
      score += idx;
    }
    if (!ok) continue;
    scored.push({ doc, score });
  }

  scored.sort((a, b) => {
    const pa = TYPE_PRIORITY[a.doc.type] ?? 99;
    const pb = TYPE_PRIORITY[b.doc.type] ?? 99;
    if (pa !== pb) return pa - pb;
    if (a.score !== b.score) return a.score - b.score;
    return a.doc.label.localeCompare(b.doc.label, 'es');
  });

  return scored.map(s => s.doc);
}

/* =========================
   Render
   ========================= */

function clearResults(resultsBox){
  resultsBox.innerHTML = '';
  resultsBox.classList.remove('open');
}

function renderResults(resultsBox, docs, selectedIndex){
  resultsBox.innerHTML = '';
  if (!docs.length){
    resultsBox.classList.remove('open');
    return;
  }

  const frag = document.createDocumentFragment();
  docs.forEach((doc, idx) => {
    const item = el('div', {
      class: 'suggest-item' + (idx === selectedIndex ? ' selected' : ''),
      'data-system': doc.system,
      'data-id': String(doc.id)
    });

    const icon = makeIcon(doc);

    const textBlock = el('div', { class: 's-text' });
    const labelEl = el('div', { class: 's-label' });
    labelEl.textContent = doc.label;
    const subEl = el('div', { class: 's-sub' });
    subEl.textContent = typeLabel(doc);
    textBlock.appendChild(labelEl);
    textBlock.appendChild(subEl);

    item.appendChild(icon);
    item.appendChild(textBlock);
    frag.appendChild(item);
  });

  resultsBox.appendChild(frag);
  resultsBox.classList.add('open');
}

/* =========================
   Selección
   ========================= */

function selectDoc(doc){
  if (!doc) return;
  const system = doc.system;
  const id = String(doc.id);

  let selector = `#sidebar input[type="checkbox"][data-system="${system}"][data-id="${CSS.escape(id)}"]`;
  let chk = document.querySelector(selector);

  if (!chk && (system === 'wr' || system === 'wrAero' || system === 'wrOtros' || system === 'wrSemi')){
    const base = id.split('-')[0];
    selector = `#sidebar input[type="checkbox"][data-system="${system}"][data-id="${CSS.escape(base)}"]`;
    chk = document.querySelector(selector);
  }

  if (chk){
    if (!chk.checked) chk.click();
    const item = chk.closest('.item');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }
}

/* =========================
   Setup
   ========================= */

export function setupSearch(){
  const input = $('#searchInput');
  const resultsBox = $('#searchSuggest');
  const btnClear = $('#btnClearSearch');

  if (!input || !resultsBox){
    console.warn('[search] No se encontró #searchInput o #searchSuggest en el DOM.');
    return;
  }

  buildSearchIndex().catch(err => {
    console.warn('[search] Error al construir índice inicial:', err);
  });

  let currentDocs = [];
  let selectedIndex = -1;

  input.addEventListener('input', async () => {
    const q = input.value;
    if (!q.trim()){
      currentDocs = [];
      selectedIndex = -1;
      clearResults(resultsBox);
      return;
    }
    const index = await buildSearchIndex();
    const hits = rankDocs(index, q).slice(0, 25);
    currentDocs = hits;
    selectedIndex = hits.length ? 0 : -1;
    renderResults(resultsBox, hits, selectedIndex);
  });

  input.addEventListener('keydown', e => {
    if (!currentDocs.length) return;
    if (e.key === 'ArrowDown'){
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % currentDocs.length;
      renderResults(resultsBox, currentDocs, selectedIndex);
    } else if (e.key === 'ArrowUp'){
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + currentDocs.length) % currentDocs.length;
      renderResults(resultsBox, currentDocs, selectedIndex);
    } else if (e.key === 'Enter'){
      e.preventDefault();
      const doc = currentDocs[selectedIndex] || currentDocs[0];
      clearResults(resultsBox);
      selectedIndex = -1;
      selectDoc(doc);
    } else if (e.key === 'Escape'){
      e.preventDefault();
      currentDocs = [];
      selectedIndex = -1;
      clearResults(resultsBox);
    }
  });

  resultsBox.addEventListener('click', e => {
    const item = e.target.closest('.suggest-item');
    if (!item) return;
    const idx = Array.from(resultsBox.querySelectorAll('.suggest-item')).indexOf(item);
    const doc = currentDocs[idx];
    clearResults(resultsBox);
    selectedIndex = -1;
    if (doc) selectDoc(doc);
  });

  if (btnClear){
    btnClear.addEventListener('click', () => {
      input.value = '';
      currentDocs = [];
      selectedIndex = -1;
      clearResults(resultsBox);
      input.focus();
    });
  }

  document.addEventListener('click', e => {
    if (e.target === input) return;
    if (resultsBox.contains(e.target)) return;
    currentDocs = [];
    selectedIndex = -1;
    clearResults(resultsBox);
  });
}