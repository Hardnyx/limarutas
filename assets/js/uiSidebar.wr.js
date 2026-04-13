// uiSidebar.wr.js
import { state } from './config.js';
import { el } from './utils.js';
import { setWikiroutesVisible } from './mapLayers.js';
import { syncTriFromLeaf } from './uiSidebar.hierarchy.js';

/* =========================
   Wikiroutes: carga de metadata y extremos
   ========================= */

let wrListaMetaPromise = null;
let wrExtremesPromise = null;

function wrCanonicalCode(value){
  const s = String(value || '').trim();
  if (!s) return '';
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n);
  return s.toUpperCase();
}

function loadWrListaMeta(){
  if (wrListaMetaPromise) return wrListaMetaPromise;

  wrListaMetaPromise = fetch('pipeline/input/lista_rutas.csv')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then(text => {
      const lines = text.trim().split(/\r?\n/);
      const metaByCodigo = {};
      if (!lines.length) return metaByCodigo;

      const header = lines[0].split(',');
      const idxCodigo  = header.findIndex(h => h.trim() === 'codigo_nuevo');
      const idxOri     = header.findIndex(h => h.trim() === 'distrito_origen');
      const idxDes     = header.findIndex(h => h.trim() === 'distrito_destino');
      const idxEmp     = header.findIndex(h => h.trim() === 'empresa_operadora');
      const idxAlias   = header.findIndex(h => h.trim() === 'alias');

      for (let i = 1; i < lines.length; i++){
        const raw = lines[i].trim();
        if (!raw) continue;

        const cols = raw.split(',');
        const codigo = (idxCodigo >= 0 && cols[idxCodigo]) ? cols[idxCodigo].trim() : '';
        if (!codigo) continue;

        const key = wrCanonicalCode(codigo);
        metaByCodigo[key] = {
          codigo_nuevo: codigo,
          distrito_origen: idxOri >= 0 ? (cols[idxOri] || '').trim() : '',
          distrito_destino: idxDes >= 0 ? (cols[idxDes] || '').trim() : '',
          empresa_operadora: idxEmp >= 0 ? (cols[idxEmp] || '').trim() : '',
          alias: idxAlias >= 0 ? (cols[idxAlias] || '').trim() : ''
        };
      }

      return metaByCodigo;
    })
    .catch(err => {
      console.error('No se pudo cargar config/lista_rutas.csv', err);
      return {};
    });

  return wrListaMetaPromise;
}

function loadWrExtremes(){
  if (wrExtremesPromise) return wrExtremesPromise;

  wrExtremesPromise = fetch('pipeline/output/wr_extremes.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(err => {
      console.error('No se pudo cargar config/wr_extremes.json', err);
      return {};
    });

  return wrExtremesPromise;
}

/* =========================
   Filtrado por grupo (catalog.json)
   ========================= */

function wrFilterRoutesByGroup(groupName, routes){
  const catalog = state.catalog || {};
  const upper = s => String(s).toUpperCase().trim();

  let cfg = null;
  if (groupName === 'transporte'){
    cfg = catalog.transporte || null;
  } else if (groupName === 'aerodirecto'){
    cfg = catalog.aerodirecto || null;
  } else if (groupName === 'expreso_san_isidro'){
    cfg = (catalog.otros && catalog.otros.expreso_san_isidro) || null;
  } else {
    return routes || [];
  }

  if (!cfg) return routes || [];

  // mode "all": sin filtro. mode "atu": igual que "only" hasta migración del CSV.
  if (cfg.mode === 'all') return routes || [];

  const only = Array.isArray(cfg.only) ? new Set(cfg.only.map(upper)) : null;
  const exc  = Array.isArray(cfg.exclude) ? new Set(cfg.exclude.map(upper)) : new Set();

  function basesFor(idRaw) {
    let base = upper(idRaw || '');
    const mTrip = base.match(/^(.*?)-(IDA|VUELTA)$/i);
    if (mTrip) base = mTrip[1];

    const out = new Set();
    if (base) out.add(base);

    // extrae la parte numérica final: "1_52587" → "52587"
    const mSuffix = base.match(/^\d+_(\d+)$/);
    if (mSuffix) out.add(mSuffix[1]);

    const m = base.match(/^(.+)_\d+$/);
    if (m && m[1]) out.add(m[1]);

    if (/^\d+$/.test(base)) out.add(String(Number(base)));

    return Array.from(out);
  };

  return (routes || []).filter(rt => {
    const bases = basesFor(rt && rt.id != null ? rt.id : '');
    if (!bases.length) return false;

    if (bases.some(b => exc.has(b))) return false;
    if (only) return bases.some(b => only.has(b));
    return true;
  });
}

/* =========================
   Texto: título, empresa, extremos
   ========================= */

function wrIsPlaceholder(text){
  if (!text) return false;
  const n = String(text).trim().toLowerCase();
  return (
    n === 'ninguno' ||
    n === 'ninguna' ||
    n === 'desconocido' ||
    n === 'desconocida' ||
    n === '?' ||
    n === '¿?' ||
    n === '-' ||
    n === 'sin nombre'
  );
}

function wrFindSiglasEmpresa(empresa){
  if (!empresa) return '';
  const matches = [...empresa.matchAll(/\(([^)]+)\)/g)];
  if (!matches.length) return '';

  if (matches.length === 1) return matches[0][1].trim();

  let withE = null;
  for (const m of matches){
    const txt = m[1].trim();
    if (txt && txt[0].toUpperCase() === 'E'){
      withE = txt;
      break;
    }
  }
  return (withE || matches[0][1]).trim();
}

function wrBuildEmpresaDisplay(empresaRaw){
  if (!empresaRaw) return '';
  let s = empresaRaw.trim();
  if (s.length <= 30) return s;

  const prefixes = [
    'Empresa de Transportes y Servicios',
    'Empresa de Transportes',
    'Empresa de Transporte'
  ];
  for (const pref of prefixes){
    const needle = pref + ' ';
    if (s.startsWith(needle)){
      s = s.slice(needle.length);
      break;
    }
  }

  const suffixes = [' S.A.C.', ' S.A.'];
  for (const suf of suffixes){
    if (s.endsWith(suf)){
      s = s.slice(0, s.length - suf.length);
      break;
    }
  }

  return s.trim();
}

function wrBuildTituloPrincipal(meta, rt){
  const rawAlias = meta && meta.alias ? String(meta.alias).trim() : '';
  const alias = rawAlias && !wrIsPlaceholder(rawAlias) ? rawAlias : '';

  const rawEmpresa = meta && meta.empresa_operadora
    ? String(meta.empresa_operadora).trim()
    : '';
  const empresa = rawEmpresa && !wrIsPlaceholder(rawEmpresa) ? rawEmpresa : '';
  const siglas = wrFindSiglasEmpresa(rawEmpresa);

  if (alias){
    return siglas ? `${alias} - ${siglas}` : alias;
  }

  if (siglas) return siglas;
  if (empresa) return wrBuildEmpresaDisplay(empresa);

  if (rt && rt.label) return rt.label;

  if (rt && rt.id != null) return String(rt.id).toUpperCase();
  return '';
}

function wrParseBaseStops(source){
  if (!source) return { from:'', to:'', label:'' };

  if (typeof source === 'string'){
    const raw = source.trim();
    if (!raw) return { from:'', to:'', label:'' };

    let s = raw;
    s = s.replace(/^\s*\d+\s*·\s*/,'');
    s = s.replace(/\s*\((ida|vuelta)\)\s*$/i,'');

    let parts = s.split('→');
    if (parts.length === 2){
      const from = parts[0].trim();
      const to   = parts[1].trim();
      return { from, to, label:`${from} \u2192 ${to}` };
    }

    parts = s.split(/\s*-\s*/);
    if (parts.length === 2){
      const from = parts[0].trim();
      const to   = parts[1].trim();
      return { from, to, label:`${from} \u2192 ${to}` };
    }

    return { from:'', to:'', label:s.trim() };
  }

  const props = source;

  const directFrom =
    props.from ||
    props.from_short ||
    props.fromShort ||
    props.origen ||
    props.origin ||
    null;

  const directTo =
    props.to ||
    props.to_short ||
    props.toShort ||
    props.destino ||
    props.destination ||
    null;

  if (directFrom || directTo){
    const from = String(directFrom || '').trim();
    const to   = String(directTo   || '').trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return { from, to, label };
  }

  if (Array.isArray(props.stops) && props.stops.length){
    const first = props.stops[0];
    const last  = props.stops[props.stops.length - 1];
    const getName = st => (st && (st.name || st.title || st.label || '')) || '';
    const from = String(getName(first)).trim();
    const to   = String(getName(last)).trim();
    const label = (from || to) ? `${from} \u2192 ${to}` : '';
    return { from, to, label };
  }

  let rawName = '';
  if (props.name != null) rawName = String(props.name);
  else if (props.title != null) rawName = String(props.title);

  if (!rawName.trim()) return { from:'', to:'', label:'' };

  let s = rawName;
  s = s.replace(/^\s*\d+\s*·\s*/,'');
  s = s.replace(/\s*\((ida|vuelta)\)\s*$/i,'');

  let parts = s.split('→');
  if (parts.length === 2){
    const from = parts[0].trim();
    const to   = parts[1].trim();
    return { from, to, label:`${from} \u2192 ${to}` };
  }

  parts = s.split(/\s*-\s*/);
  if (parts.length === 2){
    const from = parts[0].trim();
    const to   = parts[1].trim();
    return { from, to, label:`${from} \u2192 ${to}` };
  }

  return { from:'', to:'', label:s.trim() };
}

function wrStopsFromExtremesForRoute(routeLike, extremes, dirKey){
  if (!routeLike || !extremes) return null;

  const candidates = [];

  if (typeof routeLike === 'string' || typeof routeLike === 'number'){
    candidates.push(routeLike);
  } else {
    const r = routeLike;
    if (r.wr_id    != null) candidates.push(r.wr_id);
    if (r.wrId     != null) candidates.push(r.wrId);
    if (r.route_id != null) candidates.push(r.route_id);
    if (r.routeId  != null) candidates.push(r.routeId);
    if (r.base_id  != null) candidates.push(r.base_id);
    if (r.id       != null) candidates.push(r.id);
  }

  for (const c of candidates){
    const key = String(c);
    const ext = extremes[key];
    if (ext && ext[dirKey]){
      const from = ext[dirKey].from ? String(ext[dirKey].from).trim() : '';
      const to   = ext[dirKey].to   ? String(ext[dirKey].to).trim()   : '';
      const label = (from || to) ? `${from} \u2192 ${to}` : '';
      return { from, to, label };
    }
  }

  return null;
}

/* =========================
   Ítem WR: Ida / Vuelta
   ========================= */

function applyWrTextsToWrItem(item, direccion){
  const rt   = item.__wrRoute || null;
  const meta = item.__wrMeta  || null;

  const stopsIda     = item.__wrStopsIda || null;
  const stopsVta     = item.__wrStopsVta || null;
  const stopsDefault = item.__wrStops    || null;

  const stops = (direccion === 'vuelta')
    ? (stopsVta || stopsIda || stopsDefault)
    : (stopsIda || stopsDefault);

  const titleEl = item.querySelector('.wr-main-title');
  const distEl  = item.querySelector('.wr-subtitle-dist');
  const routeEl = item.querySelector('.wr-subtitle-route');

  if (titleEl){
    titleEl.textContent = wrBuildTituloPrincipal(meta, rt);
  }

  if (distEl){
    let ori = meta && meta.distrito_origen ? meta.distrito_origen : '';
    let des = meta && meta.distrito_destino ? meta.distrito_destino : '';
    if (direccion === 'vuelta') [ori, des] = [des, ori];
    distEl.textContent = (ori || des) ? `${ori} \u2192 ${des}` : '';
    if (!distEl.textContent && rt && rt.subtitle) distEl.textContent = rt.subtitle;
  }

  if (routeEl){
    routeEl.textContent = '';
    let from = stops && stops.from ? stops.from : '';
    let to   = stops && stops.to   ? stops.to   : '';
    if (from || to){
      if (direccion === 'vuelta') [from, to] = [to, from];
      routeEl.textContent = `${from} \u2192 ${to}`;
      return;
    }
    const rawName = (direccion === 'vuelta' && rt && rt.nameVuelta) ? rt.nameVuelta : (rt && rt.name);
    if (rawName){
      let base = String(rawName).trim();
      base = base.replace(/^\s*\d+\s*·\s*/, '');
      base = base.replace(/\s*\((ida|vuelta)\)\s*$/i, '');
      base = base.replace(/wikiroutes\s*\d*/ig, '').trim();
      const arrow = base.match(/^(.+?)\s*→\s*(.+)$/);
      if (arrow){
        from = arrow[1].trim();
        to   = arrow[2].trim();
        routeEl.textContent = `${from} \u2192 ${to}`;
      } else if (base){
        routeEl.textContent = base;
      }
    }
  }
}

function makeWrDirPairControls(chk){
  const wrap = el('div',{ class:'dir-mini' });

  const mk = (val, label) =>
    el('button',{
      class:`segbtn-mini${(chk.dataset.sel || 'ida') === val ? ' active' : ''}`,
      'data-dir': val
    }, label);

  const bIda = mk('ida','Ida');
  const bVta = mk('vuelta','Vuelta');

  wrap.append(bIda, bVta);

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.segbtn-mini');
    if (!btn) return;

    const sel = btn.dataset.dir;
    if (!sel || sel === chk.dataset.sel) return;

    chk.dataset.sel = sel;
    [bIda, bVta].forEach(b => b.classList.toggle('active', b === btn));

    const item = wrap.closest('.item');
    if (item) applyWrTextsToWrItem(item, sel);

    if (chk.checked){
      const ida = chk.dataset.ida;
      const vta = chk.dataset.vuelta;

      if (sel === 'ida'){
        setWikiroutesVisible(ida, true, { fit:true });
        setWikiroutesVisible(vta, false);
      } else {
        setWikiroutesVisible(vta, true, { fit:true });
        setWikiroutesVisible(ida, false);
      }
    }
  });

  return wrap;
}

function makeWrItem(rt, metaByCodigo, routesById, extremes, systemId='wr'){
  const labelId = (rt.display_id || String(rt.id)).toUpperCase();
  const tagColor = (rt && rt.color) ? rt.color : '#64748b';
  const tag = el('span',{ class:'tag', style:`background:${tagColor}` }, labelId);

  const textBlock = el('div',{},
    el('div',{ class:'name wr-main-title' }, ''),
    el('div',{ class:'sub wr-subtitle-dist' }, ''),
    el('div',{ class:'sub wr-subtitle-route' }, '')
  );

  const left = el('div',{ class:'left' }, tag, textBlock);

  let idaRoute = null;
  let vtaRoute = null;
  let idaId = null;
  let vtaId = null;

  function normSide(side){
    let id = null;
    let route = null;

    if (!side) return { id, route };

    if (typeof side === 'string' || typeof side === 'number'){
      id = String(side);
      route = routesById ? (routesById.get(id) || null) : null;
    } else if (typeof side === 'object'){
      if (side.id != null) id = String(side.id);
      if (routesById && id){
        route = routesById.get(id) || side;
      } else {
        route = side;
      }
    }

    return { id, route };
  }

  if (rt && rt.pair){
    const nIda = normSide(rt.pair.ida);
    const nVta = normSide(rt.pair.vuelta);
    idaId = nIda.id;
    idaRoute = nIda.route;
    vtaId = nVta.id;
    vtaRoute = nVta.route;
  }

  const hasBothDirs = !!(idaId && vtaId);

  const dataAttrs = hasBothDirs
    ? {
        'data-id': String(rt.id),
        'data-system': systemId,
        'data-ida': idaId,
        'data-vuelta': vtaId,
        'data-sel': (rt.defaultDir || 'ida')
      }
    : {
        'data-id': String(rt.id),
        'data-system': systemId
      };

  const chk  = el('input', Object.assign({ type:'checkbox', checked:false }, dataAttrs));
  const head = el('div',{ class:'item-head' }, left, chk);

  const body = hasBothDirs
    ? el('div',{ class:'item' }, head, makeWrDirPairControls(chk))
    : el('div',{ class:'item' }, head);

  const key = wrCanonicalCode(rt.id);
  body.__wrMeta  = metaByCodigo ? (metaByCodigo[key] || null) : null;
  body.__wrRoute = rt;

  const computeStops = (prefId, routeObj, dirKey) => {
    if (prefId != null){
      const byId = wrStopsFromExtremesForRoute(String(prefId), extremes, dirKey);
      if (byId) return byId;
    }
    if (routeObj){
      const byObj = wrStopsFromExtremesForRoute(routeObj, extremes, dirKey);
      if (byObj) return byObj;
    }
    return routeObj ? wrParseBaseStops(routeObj) : { from:'', to:'', label:'' };
  };

  let stopsIda = null;
  let stopsVta = null;

  if (hasBothDirs){
    stopsIda = computeStops(idaId, idaRoute, 'ida');
    stopsVta = computeStops(vtaId, vtaRoute, 'vuelta');
  }

  const stopsDefault = hasBothDirs
    ? (stopsIda || stopsVta || null)
    : (wrStopsFromExtremesForRoute(rt, extremes, 'ida') || wrParseBaseStops(rt));

  body.__wrStopsIda = stopsIda;
  body.__wrStopsVta = stopsVta;
  body.__wrStops    = stopsDefault;

  const initialDir = hasBothDirs ? (chk.dataset.sel || 'ida') : 'ida';
  applyWrTextsToWrItem(body, initialDir);

  chk.addEventListener('change', () => {
    if (hasBothDirs){
      const ida = chk.dataset.ida;
      const vta = chk.dataset.vuelta;
      const sel = chk.dataset.sel || 'ida';

      if (chk.checked){
        if (sel === 'ida'){
          setWikiroutesVisible(ida, true,  { fit:true });
          setWikiroutesVisible(vta, false);
        } else {
          setWikiroutesVisible(vta, true,  { fit:true });
          setWikiroutesVisible(ida, false);
        }
      } else {
        setWikiroutesVisible(ida, false);
        setWikiroutesVisible(vta, false);
      }
    } else {
      if (chk.checked) setWikiroutesVisible(rt.id, true, { fit:true });
      else             setWikiroutesVisible(rt.id, false);
    }

    syncTriFromLeaf(systemId);
  });

  return body;
}

/* =========================
   Fillers por grupo
   ========================= */

async function fillWrGroup(list, groupName, systemIdForItems){
  if (!list) return;
  list.innerHTML = '';

  const [metaByCodigo, extremes] = await Promise.all([
    loadWrListaMeta(),
    loadWrExtremes()
  ]);

  const wr = state.systems.wr;
  const allRoutes = Array.isArray(wr.routes) ? wr.routes : [];

  const routesById = new Map();
  allRoutes.forEach(r => {
    if (r && r.id != null) routesById.set(String(r.id), r);
  });

  const srcBase = (Array.isArray(wr.routesUi) && wr.routesUi.length) ? wr.routesUi : allRoutes;
  const src = wrFilterRoutesByGroup(groupName, srcBase);

  (src || []).forEach(rt => {
    if (!rt) return;
    list.appendChild(makeWrItem(rt, metaByCodigo, routesById, extremes, systemIdForItems));
  });
}

export async function fillWrList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.list, 'transporte', 'wr');
}

export async function fillAeroList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.listAero, 'aerodirecto', 'wrAero');
}

export async function fillOtrosList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.listOtros, 'expreso_san_isidro', 'wrOtros');
}