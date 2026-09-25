// uiSidebar.corr.js
import { PATHS, state } from './config.js';
import { $, el } from './utils.js';
import { syncTriFromLeaf, syncAllTri } from './uiSidebar.hierarchy.js';
import { toggleLeaf, refreshLeafDirection } from './leafToggle.js';

/* =========================
   Corredores
   ========================= */

// Colores oficiales para corredores según primer dígito del servicio
const CORR_COLORS = {
  '1': '#ffcd00', // Amarillo
  '2': '#e4002b', // Rojo
  '3': '#003594', // Azul
  '4': '#9b26b6', // Morado
  '5': '#8e8c13'  // Verde
};

const CORR_DIGIT_TO_KEY = {
  '1': 'amarillo',
  '2': 'rojo',
  '3': 'azul',
  '4': 'morado',
  '5': 'verde'
};

const CORR_KEY_LABEL = {
  amarillo: 'Corredor Amarillo',
  rojo: 'Corredor Rojo',
  azul: 'Corredor Azul',
  morado: 'Corredor Morado',
  verde: 'Corredor Verde',
  otros: 'Otros'
};

const CORR_KEY_COLOR = {
  amarillo: '#ffcd00',
  rojo: '#e4002b',
  azul: '#003594',
  morado: '#9b26b6',
  verde: '#8e8c13'
};

const CORR_GROUP_ORDER = ['amarillo','rojo','azul','morado','verde','otros'];

let corrTiposPromise = null;
let corrTiposCache = { principales: null, alimentadores: null };

function corrGetCatalogCfg(){
  const cat = state.catalog || {};
  return cat.corredores || cat.corr || null;
}

function corrCanonical(value){
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return String(Number(s));
  return s.toUpperCase();
}

function corrServiceCodeOf(svc){
  return String((svc && (svc.corrServicio || svc.id)) || '').trim();
}

function corrBasesFor(codeRaw){
  let base = corrCanonical(codeRaw);
  base = base.replace(/-(IDA|VUELTA)$/i,'');
  const out = new Set();
  if (base) out.add(base);
  const m = base.match(/^(.+)_\d+$/);
  if (m && m[1]) out.add(m[1]);
  return Array.from(out);
}

function corrGetColorOverrides(){
  const cfg = corrGetCatalogCfg() || {};
  const raw = cfg.color_overrides || cfg.colorOverrides || {};
  const map = {};
  for (const [k, v] of Object.entries(raw || {})){
    const kk = String(k || '').toUpperCase().trim();
    if (!kk) continue;
    map[kk] = v;
  }
  return map;
}

function corrOverrideToGroupKey(v){
  if (!v) return null;

  if (typeof v === 'object'){
    const g = v.group || v.grupo || v.key || null;
    const gg = g ? String(g).trim().toLowerCase() : '';
    return CORR_KEY_COLOR[gg] ? gg : null;
  }

  if (typeof v === 'string'){
    const s = v.trim().toLowerCase();
    if (CORR_KEY_COLOR[s]) return s;

    if (s.startsWith('#')){
      for (const [k, hex] of Object.entries(CORR_KEY_COLOR)){
        if (hex.toLowerCase() === s) return k;
      }
    }
  }

  return null;
}

function corrOverrideToColor(v){
  if (!v) return null;

  if (typeof v === 'object'){
    const c = v.color || v.hex || null;
    if (c && typeof c === 'string' && c.trim().startsWith('#')) return c.trim();
    const g = corrOverrideToGroupKey(v);
    return g ? CORR_KEY_COLOR[g] : null;
  }

  if (typeof v === 'string'){
    const s = v.trim();
    if (s.startsWith('#')) return s;
    const g = corrOverrideToGroupKey(s);
    return g ? CORR_KEY_COLOR[g] : null;
  }

  return null;
}

function corrSpecialGroupKey(codeUpper){
  const raw = String(codeUpper || '').trim().toUpperCase();
  if (!raw) return null;

  const compact = raw.replace(/[\s_-]+/g, '');

  if (compact === 'COLEBUS') return 'azul';
  if (/^SE0?2$/.test(compact)) return 'morado';
  if (/^SP0?1$/.test(compact)) return 'morado';

  return null;
}

function corrGroupKeyForCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return 'otros';

  const ov = corrGetColorOverrides();
  const v = ov[s];
  const gOv = corrOverrideToGroupKey(v);
  if (gOv) return gOv;

  const gSp = corrSpecialGroupKey(s);
  if (gSp) return gSp;

  const first = s[0];
  return CORR_DIGIT_TO_KEY[first] || 'otros';
}

function corrColorForCode(code){
  const s = String(code || '').trim().toUpperCase();
  if (!s) return null;

  const ov = corrGetColorOverrides();
  const v = ov[s];
  const cOv = corrOverrideToColor(v);
  if (cOv) return cOv;

  const gSp = corrSpecialGroupKey(s);
  if (gSp) return CORR_KEY_COLOR[gSp] || null;

  const first = s[0];
  return CORR_COLORS[first] || null;
}

function corrFilterServicesByCatalog(services){
  const cfg = corrGetCatalogCfg();
  if (!cfg) return services || [];

  const upper = x => String(x).toUpperCase().trim();
  const onlySet = Array.isArray(cfg.only)
    ? new Set(cfg.only.map(corrCanonical).map(upper))
    : null;

  const excSet = Array.isArray(cfg.exclude)
    ? new Set(cfg.exclude.map(corrCanonical).map(upper))
    : new Set();

  return (services || []).filter(svc => {
    const code = corrServiceCodeOf(svc);
    const bases = corrBasesFor(code).map(upper);
    if (!bases.length) return false;

    if (bases.some(b => excSet.has(b))) return false;
    if (onlySet) return bases.some(b => onlySet.has(b));
    return true;
  });
}

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

    // Cambiar de sentido no mueve la vista
    refreshLeafDirection(chk);
  });

  return wrap;
}

function makeServiceItemCorr(svc){
  const servicio = String(svc.corrServicio || svc.id || '').trim();
  const code = servicio || String(svc.id || '').trim();

  const color = corrColorForCode(code) || svc.corrColor || svc.color || '#10b981';
  const tag = el('span',{class:'tag', style:`background:${color}`}, code || 'Corr');

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

export function fillCorrList(){
  const sys = state.systems.corr;
  const container = sys.ui.list;
  const empty = $('#p-corr-empty');

  container.innerHTML = '';
  sys.ui.groups.clear();

  if (!corrTiposPromise){
    loadCorrTipos().finally(() => {
      fillCorrList();
      syncAllTri();
    });
  }

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
