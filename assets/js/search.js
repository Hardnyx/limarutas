// search.js
import { state } from './config.js';
import { $, el } from './utils.js';
import { loadMaestroRows } from './wrData.js';
import { wrIsPlaceholder } from './wrTexts.js';
import { entriesForFolders } from './routeEntries.js';
import { showStopRoutes } from './routeInspector.js';
import { MAP_PICK } from './mobileSheet.js';
import { toggleLeaf } from './leafToggle.js';
import { addRecent } from './recents.js';

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

// Alias como "Ninguno" o "Desconocido" no sirven para buscar ni mostrar
function cleanAlias(text){
  const s = String(text || '').trim();
  return wrIsPlaceholder(s) ? '' : s;
}

function typeLabel(doc){
  switch (doc.type){
    case 'metro':   return 'Metro de Lima';
    case 'met':     return 'Metropolitano';
    case 'alim':    return 'Alimentadores';
    case 'corr':    return 'Corredores';
    case 'wrAero':  return 'AeroDirecto';
    case 'wrOtros': return 'Expreso San Isidro';
    case 'wrSemi':  return 'Rutas antiguas';
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

  if (doc.type === 'stop'){
    wrap.classList.add('s-ico-stop');
    wrap.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">'
      + '<path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
    return wrap;
  }

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

  const lista = await loadMaestroRows();
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
    // Sin casilla en ninguna lista (rutas fuera del catálogo): no se puede elegir
    if (!semiChk && !document.querySelector(
      `#panels .item input[type="checkbox"][data-system="wr"][data-id="${CSS.escape(idStr)}"]`
    )) continue;

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
   Paraderos (wr_stops_index.json)
   ========================= */

const STOP_MIN_CHARS = 3;
const MAX_STOPS = 3;
// Un mismo nombre puede estar en varios lugares (hay "Separadora Industrial"
// en Santa Anita, Ate, La Molina, Villa El Salvador...): se listan todos
const MAX_SAME_NAME = 10;
const MAX_STOP_ROUTES = 20;

let stopsIndexPromise = null;

// Se carga recién al buscar algo que pueda ser un paradero
function loadStopsIndex(){
  if (stopsIndexPromise) return stopsIndexPromise;
  stopsIndexPromise = fetch('pipeline/output/wr_stops_index.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(({ routes, stops }) => stops.map(([name, lat, lon, idx, district, neighbor]) => ({
      name,
      key: norm(name).replace(/[^a-z0-9]+/g, ' ').trim(),
      lat,
      lon,
      folderIds: idx.map(i => routes[i]),
      district: district || '',
      neighbor: neighbor || ''
    })))
    .catch(err => {
      console.warn('[search] Sin índice de paraderos:', err.message);
      return [];
    });
  return stopsIndexPromise;
}

function findStops(stops, query){
  const q = norm(query).replace(/[^a-z0-9]+/g, ' ').trim();
  if (q.length < STOP_MIN_CHARS) return [];
  const words = q.split(' ');
  const hits = [];
  for (const st of stops){
    if (!words.every(w => st.key.includes(w))) continue;
    const rank = st.key === q ? 0
      : st.key.startsWith(q) ? 1
      : (` ${st.key}`).includes(` ${q}`) ? 2 : 3;
    hits.push({ st, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || b.st.folderIds.length - a.st.folderIds.length);
  // Paraderos cuyas rutas no están en ninguna lista del sidebar no sirven
  const out = [];
  for (const { st, rank } of hits){
    if (!entriesForFolders(st.folderIds).length) continue;
    // Coincidencia clara: el nombre completo, o su inicio con 5+ letras
    st.strong = rank === 0 || (rank === 1 && q.length >= 5);
    out.push(st);
    // Si el mejor nombre se repite en varios lugares, se muestran todos
    const sameName = out.filter(x => x.key === out[0].key).length;
    if (out.length >= MAX_STOPS && (sameName < out.length || sameName >= MAX_SAME_NAME)) break;
  }
  return out;
}

// Lugares con el mismo nombre que el mejor resultado
function sameNameStops(stops){
  return stops.filter(st => st.key === stops[0].key);
}

// withNeighbor: agrega "cerca de …" cuando hay varios con el mismo nombre
// en el mismo distrito
function stopDoc(st, { withNeighbor = false } = {}){
  // Rutas elegibles en el sidebar (sin duplicados de Wikiroutes)
  const n = entriesForFolders(st.folderIds).length;
  const parts = ['Paradero'];
  if (st.district) parts.push(st.district);
  if (withNeighbor && st.neighbor) parts.push(`cerca de ${st.neighbor}`);
  parts.push(`${n} ${n === 1 ? 'ruta' : 'rutas'}`);
  return {
    key: `stop:${st.key}:${st.lat},${st.lon}`,
    system: 'stop',
    id: st.key,
    type: 'stop',
    label: st.name,
    sub: parts.join(' · '),
    stop: st
  };
}

// Documentos de varios lugares con el mismo nombre, desambiguados
function sameNameDocs(stops){
  const perDistrict = {};
  stops.forEach(st => { perDistrict[st.district] = (perDistrict[st.district] || 0) + 1; });
  return stops
    .map(st => ({ st, n: entriesForFolders(st.folderIds).length }))
    .sort((a, b) => b.n - a.n)
    .map(({ st }) => stopDoc(st, { withNeighbor: perDistrict[st.district] > 1 }));
}

// Rutas que paran en el paradero, como resultados normales del buscador
// Transporte público primero; rutas antiguas (semiformal) al final
const STOP_ROUTE_ORDER = { wr: 0, corr: 1, wrAero: 2, wrOtros: 3, wrSemi: 4 };

function stopRouteDocs(st){
  const entries = entriesForFolders(st.folderIds).sort((a, b) =>
    (STOP_ROUTE_ORDER[a.leaf.dataset.system] ?? 9) - (STOP_ROUTE_ORDER[b.leaf.dataset.system] ?? 9));
  return entries.slice(0, MAX_STOP_ROUTES).map(e => ({
    key: `${e.leaf.dataset.system}:${e.leaf.dataset.id}`,
    system: e.leaf.dataset.system,
    id: e.leaf.dataset.id,
    type: e.leaf.dataset.system,
    label: e.title || e.code,
    sub: `Para en ${st.name}`,
    color: e.color,
    display_id: e.code
  }));
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
    subEl.textContent = doc.sub || typeLabel(doc);
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
  // En celular la hoja baja antes de encuadrar
  document.dispatchEvent(new Event(MAP_PICK));
  if (doc.type === 'stop'){
    showStopRoutes(doc.stop);
    return;
  }
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
    if (!chk.checked){
      chk.click();
    } else {
      // Ya estaba en el mapa: elegirla es "ir a ella" y pasa a ser la reciente
      toggleLeaf(chk, true, { fit: true });
      addRecent(chk);
    }
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

  // Precarga del índice de paraderos cuando el navegador esté libre
  (window.requestIdleCallback || (fn => setTimeout(fn, 1500)))(() => { loadStopsIndex(); });

  let currentDocs = [];
  let selectedIndex = -1;
  let querySeq = 0;

  input.addEventListener('input', async () => {
    const q = input.value;
    const seq = ++querySeq;
    if (!q.trim()){
      currentDocs = [];
      selectedIndex = -1;
      clearResults(resultsBox);
      return;
    }
    const index = await buildSearchIndex();
    const routeHits = rankDocs(index, q);

    // Paraderos que coinciden y, debajo, las rutas que paran en el primero
    const stops = q.trim().length >= STOP_MIN_CHARS ? findStops(await loadStopsIndex(), q) : [];
    if (seq !== querySeq) return;   // llegó otra búsqueda mientras cargaba

    let hits = routeHits.slice(0, 25);
    const same = stops.length ? sameNameStops(stops) : [];
    if (same.length > 1 && stops[0].strong){
      // Nombre ambiguo: cada lugar con su distrito, sin asumir cuál es
      const others = routeHits.slice(0, 8);
      hits = [...sameNameDocs(same.slice(0, MAX_SAME_NAME)), ...others];
    } else if (stops.length && stops[0].strong){
      // Coincide con un paradero: primero él y las rutas que paran ahí
      const viaStop = stopRouteDocs(stops[0]);
      const seen = new Set(viaStop.map(d => `${d.system}:${d.id}`));
      const others = routeHits.filter(d => !seen.has(`${d.system}:${d.id}`)).slice(0, 8);
      hits = [stopDoc(stops[0]), ...viaStop, ...stops.slice(1).map(st => stopDoc(st)), ...others];
    } else if (stops.length){
      // Búsqueda ambigua: rutas primero, paraderos al final
      hits = [...routeHits.slice(0, 15), ...stops.map(st => stopDoc(st))];
    }
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
      e.stopPropagation();   // este Esc es solo para las sugerencias
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