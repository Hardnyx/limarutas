import { setControlSelected } from './routeControls.js';
import { createCorridorPolicy, corrCanonical, corrServiceCodeOf, CORR_KEY_LABEL, CORR_GROUP_ORDER } from './corridorPolicy.js';
// uiSidebar.corr.js
import { PATHS, state } from './config.js';
import { isLightColor } from './mapColors.js';
import { $, el } from './utils.js';
import { syncTriFromLeaf } from './uiSidebar.hierarchy.js';
import { toggleLeaf, refreshLeafDirection } from './leafToggle.js';

/* =========================
   Corredores
   ========================= */

// Colores oficiales para corredores según primer dígito del servicio
let corrTiposPromise = null;
let corrTiposCache = { principales: null, alimentadores: null };
const corrGroupKeyForCode = code => createCorridorPolicy(state.catalog).groupKey(code);
const corrColorForCode = code => createCorridorPolicy(state.catalog).color(code);
const corrFilterServicesByCatalog = services => createCorridorPolicy(state.catalog).filter(services);

function corrPickArray(node){
  if (!node) return null;
  if (Array.isArray(node)) return node;
  if (node && typeof node === 'object'){
    if (Array.isArray(node.only)) return node.only;
    if (Array.isArray(node.items)) return node.items;
    if (Array.isArray(node.codigos)) return node.codigos;
    if (Array.isArray(node.activos)) return node.activos;
  }
  return null;
}

function corrParseTipos(json){
  const upper = x => String(x).toUpperCase().trim();

  const root =
    (json && (json.corredores || json.corr)) ||
    json ||
    {};

  const pNode =
    root.principales || root.principal ||
    (root.tipos && (root.tipos.principales || root.tipos.principal)) ||
    (json && (json.principales || json.principal)) ||
    null;

  const aNode =
    root.alimentadores || root.alimentador ||
    (root.tipos && (root.tipos.alimentadores || root.tipos.alimentador)) ||
    (json && (json.alimentadores || json.alimentador)) ||
    null;

  const pArr = corrPickArray(pNode);
  const aArr = corrPickArray(aNode);

  const principales = pArr ? new Set(pArr.map(corrCanonical).map(upper)) : null;
  const alimentadores = aArr ? new Set(aArr.map(corrCanonical).map(upper)) : null;

  return { principales, alimentadores };
}

function loadCorrTipos(){
  if (corrTiposPromise) return corrTiposPromise;

  const url =
    (PATHS && PATHS.listas && (PATHS.listas.corredores_tipos || PATHS.listas.corredoresTipos))
      ? (PATHS.listas.corredores_tipos || PATHS.listas.corredoresTipos)
      : 'config/lista_corredores.json';

  corrTiposPromise = fetch(url)
    .then(r => (r.ok ? r.json() : null))
    .then(json => {
      if (!json) return { principales: null, alimentadores: null };
      const parsed = corrParseTipos(json);
      corrTiposCache = parsed;
      return parsed;
    })
    .catch(() => {
      corrTiposCache = { principales: null, alimentadores: null };
      return corrTiposCache;
    });

  return corrTiposPromise;
}

function corrIsAlimentadorByHeuristic(code){
  const s = corrCanonical(code);
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  const inRange = (a, b) => n >= a && n <= b;

  return (
    inRange(150, 199) ||
    inRange(250, 299) ||
    inRange(350, 399) ||
    inRange(450, 499) ||
    inRange(550, 599)
  );
}

function corrIsAlimentador(code){
  const upper = x => String(x).toUpperCase().trim();
  const c = upper(corrCanonical(code));

  if (corrTiposCache && corrTiposCache.alimentadores && corrTiposCache.alimentadores.has(c)) return true;
  if (corrTiposCache && corrTiposCache.principales && corrTiposCache.principales.has(c)) return false;

  return corrIsAlimentadorByHeuristic(code);
}

function corrSortServices(arr){
  const canonUpper = (svc) => String(corrCanonical(corrServiceCodeOf(svc))).toUpperCase().trim();

  const keyOf = (svc) => {
    const s = canonUpper(svc);
    if (/^\d+$/.test(s)) return { t: 0, n: Number(s), s };
    return { t: 1, n: 0, s };
  };

  return (arr || []).sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka.t !== kb.t) return ka.t - kb.t;
    if (ka.t === 0 && ka.n !== kb.n) return ka.n - kb.n;
    return ka.s.localeCompare(kb.s);
  });
}

function wrParseBaseStops(source){
  if (!source) return {from:'', to:'', label:''};

  if (typeof source === 'string'){
    const raw = source.trim();
    if (!raw) return {from:'', to:'', label:''};
    let s = raw;
    s = s.replace(/^\s*\d+\s*·\s*/,'');
    s = s.replace(/\s*\((ida|vuelta)\)\s*$/i,'');

    let parts = s.split('→');
    if (parts.length === 2){
      const from = parts[0].trim();
      const to   = parts[1].trim();
      return {from, to, label:`${from} \u2192 ${to}`};
    }
    parts = s.split(/\s*-\s*/);
    if (parts.length === 2){
      const from = parts[0].trim();
      const to   = parts[1].trim();
      return {from, to, label:`${from} \u2192 ${to}`};
    }
    return {from:'', to:'', label:s.trim()};
  }

  const props = source;
  const directFrom =
    props.from || props.from_short || props.fromShort || props.origen || props.origin || null;
  const directTo =
    props.to || props.to_short || props.toShort || props.destino || props.destination || null;

  if (directFrom || directTo){
    const from = String(directFrom || '').trim();
    const to   = String(directTo || '').trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return {from, to, label};
  }

  if (Array.isArray(props.stops) && props.stops.length){
    const first = props.stops[0];
    const last  = props.stops[props.stops.length - 1];
    const getName = st => (st ? (st.name || st.title || st.label || '') : '');
    const from = String(getName(first) || '').trim();
    const to   = String(getName(last) || '').trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return {from, to, label};
  }

  let rawName = '';
  if (props.name != null) rawName = String(props.name);
  else if (props.title != null) rawName = String(props.title);

  if (!rawName.trim()) return {from:'', to:'', label:''};

  let s = rawName;
  s = s.replace(/^\s*\d+\s*·\s*/,'');
  s = s.replace(/\s*\((ida|vuelta)\)\s*$/i,'');

  let parts = s.split('→');
  if (parts.length === 2){
    const from = parts[0].trim();
    const to   = parts[1].trim();
    return {from, to, label:`${from} \u2192 ${to}`};
  }
  parts = s.split(/\s*-\s*/);
  if (parts.length === 2){
    const from = parts[0].trim();
    const to   = parts[1].trim();
    return {from, to, label:`${from} \u2192 ${to}`};
  }

  return {from:'', to:'', label:s.trim()};
}

function normPairId(side){
  if (!side) return null;
  if (typeof side === 'string' || typeof side === 'number') return String(side);
  if (typeof side === 'object'){
    if (side.id != null) return String(side.id);
    if (side.route_id != null) return String(side.route_id);
    if (side.routeId != null) return String(side.routeId);
  }
  return null;
}

function applyCorrTextsToItem(item, direccion){
  const svc = item.__corrSvc || null;
  if (!svc) return;

  const titleEl = item.querySelector('.corr-main-title');
  const odEl    = item.querySelector('.corr-subtitle-od');
  const extraEl = item.querySelector('.corr-subtitle-extra');

  const servicio = String(svc.corrServicio || svc.id || '').trim();

  if (titleEl){
    titleEl.textContent = servicio ? `Servicio ${servicio}` : 'Servicio';
  }

  let ori = (svc.corrOrigen != null ? String(svc.corrOrigen).trim() : '');
  let des = (svc.corrDestino != null ? String(svc.corrDestino).trim() : '');

  if (!(ori || des)){
    const parsed = wrParseBaseStops(svc.name || svc.title || '');
    ori = parsed.from || '';
    des = parsed.to || '';
  }

  if (direccion === 'vuelta'){
    [ori, des] = [des, ori];
  }

  if (odEl){
    odEl.textContent = (ori || des) ? `${ori} \u2192 ${des}` : (svc.name || '');
  }

  if (extraEl){
    extraEl.textContent = '';
  }
}

function makeCorrDirPairControls(chk){
  const wrap = el('div',{class:'dir-mini'});
  const mk = (val,label) =>
    el('button',{class:`segbtn-mini${(chk.dataset.sel||'ida')===val?' active':''}`,'data-dir':val},label);

  const bIda = mk('ida','Ida');
  const bVta = mk('vuelta','Vuelta');
  wrap.append(bIda, bVta);

  wrap.addEventListener('click',(e)=>{
    const btn = e.target.closest('.segbtn-mini');
    if (!btn) return;

    const sel = btn.dataset.dir;
    if (!sel || sel === chk.dataset.sel) return;

    chk.dataset.sel = sel;
    [bIda,bVta].forEach(b=>b.classList.toggle('active', b===btn));

    const item = wrap.closest('.item');
    if (item){
      applyCorrTextsToItem(item, sel);
    }

    // Elegir sentido en una ruta sin marcar la muestra (como marcarla);
    // si ya está marcada, cambia de sentido sin mover la vista
    if (!chk.checked) setControlSelected(chk, true);
    else refreshLeafDirection(chk);
  });

  return wrap;
}

function makeServiceItemCorr(svc){
  const servicio = String(svc.corrServicio || svc.id || '').trim();
  const code = servicio || String(svc.id || '').trim();

  const color = corrColorForCode(code) || svc.corrColor || svc.color || '#10b981';
  const tag = el('span',{class: isLightColor(color) ? 'tag on-light' : 'tag', style:`background:${color}`}, code || 'Corr');

  const textBlock = el('div',{},
    el('div',{class:'name corr-main-title'}, ''),
    el('div',{class:'sub corr-subtitle-od'}, ''),
    el('div',{class:'sub corr-subtitle-extra'}, '')
  );

  const left = el('div',{class:'left'}, tag, textBlock);

  let idaId = null;
  let vtaId = null;

  if (svc.pair){
    idaId = normPairId(svc.pair.ida);
    vtaId = normPairId(svc.pair.vuelta);
  } else if (svc.ida && svc.vuelta){
    idaId = normPairId(svc.ida);
    vtaId = normPairId(svc.vuelta);
  }

  const hasBothDirs = !!(idaId && vtaId);

  const dataAttrs = hasBothDirs
    ? {
        'data-id': String(svc.id),
        'data-system': 'corr',
        'data-ida': idaId,
        'data-vuelta': vtaId,
        'data-sel': (svc.defaultDir || 'ida')
      }
    : {
        'data-id': String(svc.id),
        'data-system': 'corr'
      };

  const chk  = el('input', Object.assign({type:'checkbox','data-system':'corr'}, dataAttrs));
  const head = el('div',{class:'item-head'}, left, chk);

  const body = hasBothDirs
    ? el('div',{class:'item'}, head, makeCorrDirPairControls(chk))
    : el('div',{class:'item'}, head);

  body.__corrSvc = svc;

  const initialDir = hasBothDirs ? (chk.dataset.sel || 'ida') : 'ida';
  applyCorrTextsToItem(body, initialDir);

  chk.addEventListener('change', () => {
    toggleLeaf(chk, chk.checked, { fit: true });
    syncTriFromLeaf('corr');
  });

  return body;
}

function buildCorrGroupSection(container, key, label){
  const secId = `p-corr-${key}`;
  const chkId = `chk-corr-${key}`;

  const section = el('section',{class:'panel nested'});
  const head = el('button',{class:'panel-head','data-target':secId,'aria-expanded':'false'},
    el('span',{class:'chev'},'▸'),
    el('span',{class:'title'},label),
    el('input',{type:'checkbox',id:chkId,class:'right','data-group':key})
  );

  const body = el('div',{id:secId,class:'panel-body'});

  section.append(head, body);
  container.appendChild(section);

  const chk = head.querySelector('input[type="checkbox"]');

  const entry = { chk, body, tabs: new Map() };
  state.systems.corr.ui.groups.set(key, entry);
}

function buildCorrTabSection(parentBody, groupKey, tabKey, label){
  const secId = `p-corr-${groupKey}-${tabKey}`;
  const chkId = `chk-corr-${groupKey}-${tabKey}`;

  const section = el('section',{class:'panel nested'});
  const head = el('button',{class:'panel-head','data-target':secId,'aria-expanded':'false'},
    el('span',{class:'chev'},'▸'),
    el('span',{class:'title'},label),
    el('input',{type:'checkbox',id:chkId,class:'right','data-group':groupKey,'data-sub':tabKey})
  );
  const body = el('div',{id:secId,class:'panel-body list'});

  section.append(head, body);
  parentBody.appendChild(section);

  const chk = head.querySelector('input[type="checkbox"]');
  return { chk, body };
}

export async function fillCorrList(){
  await loadCorrTipos();
  const sys = state.systems.corr;
  const container = sys.ui.list;
  const empty = $('#p-corr-empty');

  container.innerHTML = '';
  sys.ui.groups.clear();

  const baseSrc = (state.corrWr && Array.isArray(state.corrWr.services) && state.corrWr.services.length)
    ? state.corrWr.services
    : sys.services;

  let services = (baseSrc || []).filter(s => !!s);
  services = corrFilterServicesByCatalog(services);

  if (!services.length){
    empty && (empty.style.display = 'block');
    sys.ui.chkAll && (sys.ui.chkAll.disabled = true);
    return;
  }

  empty && (empty.style.display = 'none');
  sys.ui.chkAll && (sys.ui.chkAll.disabled = false);

  const groups = new Map();
  services.forEach(s => {
    const code = corrServiceCodeOf(s);
    const key = corrGroupKeyForCode(code);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });

  CORR_GROUP_ORDER.forEach(key => {
    const arr = groups.get(key);
    if (!arr || !arr.length) return;

    const label = CORR_KEY_LABEL[key] || 'Otros';
    buildCorrGroupSection(container, key, label);

    const grp = state.systems.corr.ui.groups.get(key);

    const principales = [];
    const alimentadores = [];

    arr.forEach(svc => {
      const code = corrServiceCodeOf(svc);
      if (corrIsAlimentador(code)) alimentadores.push(svc);
      else principales.push(svc);
    });

    corrSortServices(principales);
    corrSortServices(alimentadores);

    if (principales.length){
      const tab = buildCorrTabSection(grp.body, key, 'p', 'Principales');
      grp.tabs.set('p', tab);
      principales.forEach(svc => tab.body.appendChild(makeServiceItemCorr(svc)));
    }
    if (alimentadores.length){
      const tab = buildCorrTabSection(grp.body, key, 'a', 'Alimentadores');
      grp.tabs.set('a', tab);
      alimentadores.forEach(svc => tab.body.appendChild(makeServiceItemCorr(svc)));
    }
  });
}
