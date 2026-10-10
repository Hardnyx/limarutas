import { loadStopsIndex, keyOf } from './stopRepository.js';
export { stopsNear } from './stopRepository.js';
// search.js
import { state } from './config.js';
import { $, el } from './utils.js';
import { loadMaestroRows } from './wrData.js';
import { wrIsPlaceholder, wrBuildTituloPrincipal } from './wrTexts.js';
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
    const iconId = doc.type === 'metro' ? String(doc.id).replace(/^L/i, '') : (doc.icon || doc.id);
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
    // "Metropolitano · Súper Expreso Norte desde 22 de Agosto" dice más que el id
    const label = name ? `Metropolitano · ${name}` : prefix;
    const tokens = norm([id, name, kindLabel, 'metropolitano', 'troncal'].join(' '));
    docs.push({ key: `met:${id}`, system: 'met', id, label, type: 'met', tokens, icon: svc.icon });
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

    // El mismo nombre que su fila en la lista ("Santa Catalina · La 23C");
    // el código ya va en la etiqueta de color
    const popular = (row && row.nombre_popular) || '';
    const titulo = wrBuildTituloPrincipal({ alias, empresa_operadora: empresa, nombre_popular: popular, empresa_corta: row?.empresa_corta || '' }, rt);
    const label = (titulo && titulo.toUpperCase() !== codigoNuevo.toUpperCase())
      ? titulo
      : (rt.name ? rt.name.replace(/^\s*[^\s·]+\s*·\s*/, '') : `Ruta ${codigoNuevo}`);

    const tokens = norm([
      codigoNuevo, codigoAntiguo, popular, alias, empresa, empresaCorta,
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
      meta: { codigoNuevo, codigoAntiguo, alias, empresa, siglas: empresaCorta },
      // Cada alias por separado ("La U - La A" → "la u", "la a"): "la 36" o
      // "36" encuentran primero la ruta que la gente llama así
      aliasKeys: [popular, ...(alias ? alias.split(/\s+-\s+/) : [])].map(a => norm(a.trim())).filter(Boolean)
    });
  }

  state._searchIndex = docs;
  return docs;
}

/* =========================
   Paraderos (wr_stops_index.json)
   ========================= */

const STOP_MIN_CHARS = 3;
const MAX_STOPS = 5;
// Un mismo nombre puede estar en varios lugares (hay "Separadora Industrial"
// en Santa Anita, Ate, La Molina, Villa El Salvador...): se listan todos
const MAX_SAME_NAME = 10;

// Sin "con" (nadie lo escribe al buscar "javier prado brasil")
const bare = k => k.replace(/(^| )con( |$)/g, ' ').replace(/ +/g, ' ').trim();

// Qué tan bien coincide k con q: 0 igual, 1 empieza así, 2 una palabra
// empieza así, 3 lo contiene
const rankOf = (k, q) => k === q ? 0 : k.startsWith(q) ? 1 : (` ${k}`).includes(` ${q}`) ? 2 : 3;

function findStops(stops, query){
  const q = keyOf(query);
  if (!q) return [];
  // Muy corto ("22"): solo un alias exacto (el paradero "22" de Túpac Amaru)
  const short = q.length < STOP_MIN_CHARS;
  const words = q.split(' ');
  const hits = [];
  // Por el nombre, el cruce (en cualquier orden) o un alias: "universitaria"
  // trae todos los Universitaria; "universitaria colonial", el de ese cruce;
  // "javier prado" también el paradero Brasil de Javier Prado con Brasil
  for (const st of stops){
    if (short){
      const i = st.aliasKeys.indexOf(q);
      if (i < 0) continue;
      hits.push({ st, rank: 0, swap: false, via: st.alias.split(' · ')[i] });
      continue;
    }
    const hay = [st.labelKey, st.swapKey, ...st.aliasKeys].join(' | ');
    if (!words.every(w => hay.includes(w))) continue;
    const rName = words.every(w => st.key.includes(w)) ? rankOf(st.key, q) : 9;
    const rLabel = rankOf(bare(st.labelKey), q);
    const rSwap = st.swapKey ? rankOf(bare(st.swapKey), q) : 9;
    const aRanks = st.aliasKeys.map(k => words.every(w => k.includes(w)) ? rankOf(k, q) : 9);
    const rAlias = Math.min(9, ...aRanks);
    // Se muestra empezando por la calle que se buscó
    const swap = rSwap < Math.min(rName, rLabel);
    // Encontrado por otro nombre ("Trébol de Javier Prado"): se dice cuál
    const via = rAlias < Math.min(rName, rLabel, rSwap) ? st.alias.split(' · ')[aRanks.indexOf(rAlias)] : '';
    hits.push({ st, rank: Math.min(rName, rLabel, rSwap, rAlias), swap, via });
  }
  hits.sort((a, b) => a.rank - b.rank || b.st.folderIds.length - a.st.folderIds.length);
  // Paraderos cuyas rutas no están en ninguna lista del sidebar no sirven
  const out = [];
  for (const { st, rank, swap, via } of hits){
    if (!entriesForFolders(st.folderIds).length) continue;
    const shown = swap ? { ...st, label: st.swap } : st;
    // El mismo cruce con dos paraderos ("Brasil" y "Javier Prado" en Javier
    // Prado con Brasil): uno solo, con las rutas de los dos
    const twin = out.find(o => sameCrossing(o, shown));
    if (twin){
      twin.folderIds = [...new Set([...twin.folderIds, ...shown.folderIds])];
      continue;
    }
    // Coincidencia clara: el nombre completo, o su inicio con 5+ letras
    out.push({ ...shown, via, strong: rank === 0 || (rank === 1 && q.length >= 5) });
    // Si el mejor nombre se repite en varios lugares, se muestran todos
    const sameName = out.filter(x => x.key === out[0].key).length;
    if (out.length >= MAX_STOPS && (sameName < out.length || sameName >= MAX_SAME_NAME)) break;
  }
  return out;
}

// Paraderos de Wikiroutes a menos de m metros de un punto (el más cercano
// primero): para saber qué rutas paran en un paradero tocado en el mapa
// Dos paraderos del mismo cruce: las mismas calles (en cualquier orden) y a
// menos de 200 m
function sameCrossing(a, b){
  const set = l => new Set(keyOf(l).split(' ').filter(w => w !== 'con' && w !== 'trebol' && w !== 'bypass'));
  const x = set(a.label), y = set(b.label);
  if (x.size !== y.size || [...x].some(w => !y.has(w))) return false;
  const k = Math.cos(a.lat * Math.PI / 180);
  return Math.hypot((a.lat - b.lat) * 110_574, (a.lon - b.lon) * 111_320 * k) < 200;
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
  if (st.via) parts.push(st.via);
  if (st.district) parts.push(st.district);
  // Con cruce ya se distingue; si no, el paradero vecino
  if (withNeighbor && st.neighbor && st.label === st.name) parts.push(`cerca de ${st.neighbor}`);
  parts.push(`${n} ${n === 1 ? 'ruta' : 'rutas'}`);
  return {
    key: `stop:${st.key}:${st.lat},${st.lon}`,
    system: 'stop',
    id: st.key,
    type: 'stop',
    label: st.label,
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

/* =========================
   Ranking
   ========================= */

function rankDocs(docs, query){
  const q = norm(query);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const exactAlias = new Set([q, `la ${q}`, `el ${q}`]);
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
    scored.push({ doc, score, exact: !!doc.aliasKeys?.some(k => exactAlias.has(k)) });
  }

  scored.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
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

function renderResults(resultsBox, docs, selectedIndex, query = ''){
  resultsBox.innerHTML = '';
  if (!docs.length){
    // Sin resultados: decirlo (si no, parece que el buscador no respondió)
    if (query.trim()){
      resultsBox.appendChild(el('div', { class: 'suggest-empty', role: 'status' },
        `Nada con «${query.trim()}». Prueba con el código de la ruta, la empresa o el nombre de un paradero.`));
      resultsBox.classList.add('open');
    } else {
      resultsBox.classList.remove('open');
    }
    return;
  }

  const frag = document.createDocumentFragment();
  docs.forEach((doc, idx) => {
    if (doc.type === 'header'){
      frag.appendChild(el('div', { class: 'suggest-head', role: 'presentation' }, doc.label));
      return;
    }
    const item = el('div', {
      class: 'suggest-item' + (idx === selectedIndex ? ' selected' : ''),
      id: `sg-${idx}`,
      role: 'option',
      'aria-selected': idx === selectedIndex ? 'true' : 'false',
      'data-idx': String(idx),
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

// El siguiente resultado elegible desde i (los títulos no se eligen)
function nextItem(docs, i, step){
  const n = docs.length;
  for (let k = 1; k <= n; k++){
    const j = ((i + step * k) % n + n) % n;
    if (docs[j].type !== 'header') return j;
  }
  return -1;
}

// Marca el elegido con el teclado y lo deja a la vista (la lista se desplaza)
function markSelected(resultsBox, idx){
  const input = $('#searchInput');
  resultsBox.querySelectorAll('.suggest-item.selected').forEach(n => {
    n.classList.remove('selected');
    n.setAttribute('aria-selected', 'false');
  });
  const item = resultsBox.querySelector(`[data-idx="${idx}"]`);
  if (!item) return;
  item.classList.add('selected');
  item.setAttribute('aria-selected', 'true');
  input?.setAttribute('aria-activedescendant', item.id);
  // El título del grupo también a la vista si es el primero
  const head = item.previousElementSibling;
  (head?.classList.contains('suggest-head') ? head : item).scrollIntoView({ block: 'nearest' });
  item.scrollIntoView({ block: 'nearest' });
}

// ¿Parece el código o el alias de una ruta? "1240", "la 36", "an-19", "ex9",
// "expreso 5", "corredor rojo", "linea 1"
function looksLikeRoute(q){
  const t = norm(q).trim();
  return /^\d{1,4}[a-z]?$/.test(t) || /^(la|el)\s+\d/.test(t) || /^(an|as)[\s-]?\d/.test(t)
    || /^(ex|expreso|sx|sxn|corredor|linea|l)\s*\d/.test(t) || /^(corredor|metropolitano|metro|alimentador)/.test(t);
}

/* =========================
   Selección
   ========================= */

function selectDoc(doc){
  if (!doc) return;
  // Elegido el resultado, el buscador queda listo para la siguiente búsqueda
  const input = $('#searchInput');
  if (input){ input.value = ''; input.removeAttribute('aria-activedescendant'); }
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
    const stops = findStops(await loadStopsIndex(), q);
    if (seq !== querySeq) return;   // llegó otra búsqueda mientras cargaba

    // Resultados en dos grupos, cada uno con su título: Paraderos y Rutas.
    // Primero el que parece buscarse: un código o el alias de una ruta ("1240",
    // "la 36", "AN-19") va a Rutas; el nombre de un lugar, a Paraderos
    const stopDocs = stops.length
      ? (sameNameStops(stops).length > 1 && stops[0].strong
        ? sameNameDocs(sameNameStops(stops).slice(0, MAX_SAME_NAME))
        : stops.map(st => stopDoc(st)))
      : [];
    const routeFirst = routeHits.length && (looksLikeRoute(q) || !stops.length || !stops[0].strong);
    const routeDocs = routeHits.slice(0, stopDocs.length ? (routeFirst ? 10 : 6) : 25);
    const groups = [
      ['Rutas', routeDocs],
      ['Paraderos', stopDocs]
    ];
    if (!routeFirst) groups.reverse();
    let hits = [];
    for (const [title, docs] of groups){
      if (!docs.length) continue;
      hits.push({ type: 'header', label: title, key: `h:${title}` }, ...docs);
    }
    currentDocs = hits;
    selectedIndex = nextItem(hits, -1, 1);
    renderResults(resultsBox, hits, selectedIndex, q);
  });

  input.addEventListener('keydown', e => {
    if (!currentDocs.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      selectedIndex = nextItem(currentDocs, selectedIndex, e.key === 'ArrowDown' ? 1 : -1);
      markSelected(resultsBox, selectedIndex);
    } else if (e.key === 'Enter'){
      e.preventDefault();
      const doc = currentDocs[selectedIndex] || currentDocs[nextItem(currentDocs, -1, 1)];
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
    const doc = currentDocs[Number(item.dataset.idx)];
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