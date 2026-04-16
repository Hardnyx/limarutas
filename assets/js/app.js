// app.js (punto de entrada)
import { PATHS, state } from './config.js';
import { $, $$, fetchJSON, stopsArrayToMap, asLatLng } from './utils.js';
import {
  filterByCatalogFor,
  buildAlimFromFC,
  buildCorredoresFromFC,
  buildMetroFromJSON,
  buildCorrFromWrRoutes
} from './parsers.js';
import {
  initMap,
  reRenderVisibleSystem,
  reRenderVisible,
  setBase
} from './mapLayers.js';
import {
  fillMetList,
  fillAlimList,
  fillCorrList,
  fillMetroList,
  fillWrList,
  fillAeroList,
  fillSemiformalList,
  fillOtrosList,
  wireHierarchy,
  setLevel2Checked,
  bulk,
  onLevel1ChangeCorr,
  onLevel1ChangeMetro,
  onLevel1ChangeWr,
  onLevel1ChangeWrAero,
  onLevel1ChangeWrOtros,
  onLevel1ChangeWrSemi,
  syncAllTri
} from './uiSidebar.js';
import { wirePanelTogglesOnce } from './panels.js';
import { setupSearch } from './search.js';

/* ===========================
   Helpers UI de carga
   =========================== */

function setStatus(text){
  const statusEl = $('#status');
  if (statusEl) statusEl.textContent = text;
}

function ensureSidebarOverlay(){
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return null;

  const cs = window.getComputedStyle(sidebar);
  if (cs.position === 'static' && sidebar.dataset._posFixApplied !== '1') {
    sidebar.dataset._posFixApplied = '1';
    sidebar.style.position = 'relative';
  }

  let ov = document.getElementById('sidebarLoading');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'sidebarLoading';
    ov.style.position = 'absolute';
    ov.style.inset = '0';
    ov.style.background = 'rgba(0,0,0,0.25)';
    ov.style.backdropFilter = 'blur(2px)';
    ov.style.zIndex = '9999';
    ov.style.display = 'none';
    ov.style.alignItems = 'center';
    ov.style.justifyContent = 'center';
    ov.style.padding = '16px';
    ov.style.pointerEvents = 'none';
    sidebar.appendChild(ov);
  }

  return ov;
}

function setSidebarLoading(on, msg){
  const sidebar = document.getElementById('sidebar');
  const ov = ensureSidebarOverlay();
  if (!sidebar || !ov) return;

  if (on){
    ov.innerHTML =
      `<div style="background: rgba(15,15,15,0.75); color: #fff; padding: 12px 14px; border-radius: 10px; max-width: 360px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 6px;">Cargando</div>
        <div style="opacity: 0.95;">${msg || 'Preparando rutas y paraderos...'}</div>
      </div>`;
    ov.style.display = 'flex';
  } else {
    ov.style.display = 'none';
    ov.innerHTML = '';

    if (sidebar.dataset._posFixApplied === '1') {
      delete sidebar.dataset._posFixApplied;
      sidebar.style.position = '';
    }
  }
}

function setListPlaceholder(elm, text){
  if (!elm) return;
  elm.innerHTML = `<div style="opacity:0.75; font-size: 12px; padding: 8px 6px;">${text}</div>`;
}

function disableSidebarChecks(disabled){
  const ids = [
    'chk-met','chk-met-reg','chk-met-exp',
    'chk-met-alim','chk-met-alim-n','chk-met-alim-s',
    'chk-corr','chk-metro','chk-wr',
    'chk-wr-aero','chk-wr-otros'
  ];
  ids.forEach(id => {
    const elm = document.getElementById(id);
    if (elm) elm.disabled = !!disabled;
  });
}

function nextFrame(){
  return new Promise(res => requestAnimationFrame(() => res()));
}

function pickFirst(selA, selB){
  return $(selA) || $(selB) || null;
}

/* ===========================
   Helpers Macrorutas Metropolitano
   =========================== */

// south = norte a sur, north = sur a norte
async function loadMetMacroSegments(macroId, suffix){
  const path = `${PATHS.met}/trayectos-macro/${macroId}-${suffix}.geojson`;
  try {
    const gj = await fetchJSON(path);
    if (!gj || gj.type !== 'FeatureCollection') {
      console.warn('[Met macro]', macroId, suffix, 'no es FeatureCollection');
      return null;
    }
    const segments = [];
    (gj.features || []).forEach(f => {
      const g = f.geometry;
      if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates)) return;
      const seg = g.coordinates.map(asLatLng);
      if (seg.length >= 2) segments.push(seg);
    });
    if (!segments.length) return null;
    return segments;
  } catch (e) {
    console.warn('[Met macro] No se pudo cargar', path, e.message);
    return null;
  }
}

async function loadMetMacros(){
  state.systems.met.macros = {};

  const macroIds = ['A', 'B'];
  for (const mid of macroIds) {
    const northSouth = await loadMetMacroSegments(mid, 'south');
    const southNorth = await loadMetMacroSegments(mid, 'north');
    if (northSouth || southNorth) {
      state.systems.met.macros[mid] = {};
      if (northSouth) state.systems.met.macros[mid].north_south = northSouth;
      if (southNorth) state.systems.met.macros[mid].south_north = southNorth;
    }
  }
  console.log('[Met macro] Macros disponibles:', Object.keys(state.systems.met.macros).join(', ') || '(ninguna)');
}

/* ===========================
   Loaders por sistema
   =========================== */

async function loadCatalog(){
  try {
    state.catalog = await fetchJSON('config/catalog.json');
    console.log('[Catálogo] Usando config/catalog.json');
    return;
  } catch {}

  state.catalog = await fetchJSON(`${PATHS.data}/catalog.json`).catch(()=>null);
  console.log('[Catálogo] Usando data/catalog.json');
}

async function loadMetropolitano(){
  const [stopsMet, svcsMet] = await Promise.all([
    fetchJSON(`${PATHS.met}/metropolitano_stops.json`),
    fetchJSON(`${PATHS.met}/metropolitano_services.json`)
  ]);

  state.systems.met.stops = stopsArrayToMap(stopsMet.stations);

  const colorsMet = svcsMet.colors || {};
  const metAll = (svcsMet.services || []).map(s => ({
    ...s,
    system: 'met',
    color: colorsMet[String(s.id)] || '#0ea5e9'
  }));

  state.systems.met.services = filterByCatalogFor('met', metAll, state.catalog);

  await loadMetMacros();
}

async function loadAlimentadores(){
  try {
    const alim = await fetchJSON(`${PATHS.met}/alimentadores.json`);
    if (alim && alim.type === 'FeatureCollection') {
      const parsed = buildAlimFromFC(alim);
      state.systems.alim.stops    = parsed.stops;
      state.systems.alim.services = filterByCatalogFor('alim', parsed.services, state.catalog);
      console.log('[Alimentadores] Rutas creadas:', parsed.services.length);
    } else {
      console.warn('[Alimentadores] El archivo no es FeatureCollection o está vacío.');
      state.systems.alim.stops = new Map();
      state.systems.alim.services = [];
    }
  } catch (e) {
    console.warn('Alimentadores no disponibles:', e.message);
    state.systems.alim.stops = new Map();
    state.systems.alim.services = [];
  }
}

async function loadCorredores(){
  try {
    const corrRaw = await fetchJSON(`${PATHS.corr}/corredores.json`);
    let services = [];
    let infoLog  = '';

    if (corrRaw && corrRaw.type === 'FeatureCollection') {
      const parsed = buildCorredoresFromFC(corrRaw);
      state.systems.corr.stops = parsed.stops;
      services                 = parsed.services;
      infoLog = '[Corredores] Rutas creadas: ' + services.length +
                ' | Features sin ref: ' + parsed.noRef;
    } else if (corrRaw && Array.isArray(corrRaw.services)) {
      services = corrRaw.services;
      state.systems.corr.stops = corrRaw.stops ? stopsArrayToMap(corrRaw.stops) : new Map();
      infoLog = '[Corredores] Rutas (obj): ' + services.length;
    } else {
      console.warn('[Corredores] Formato no reconocido:', corrRaw ? corrRaw.type : typeof corrRaw);
      state.systems.corr.stops = new Map();
      services = [];
    }

    state.systems.corr.services = filterByCatalogFor('corr', services, state.catalog);
    if (infoLog) console.log(infoLog);
    console.log('[Corredores] Rutas finales:', state.systems.corr.services.length);
  } catch (e) {
    console.warn('Corredores no disponibles:', e.message);
    state.systems.corr.stops = new Map();
    state.systems.corr.services = [];
  }
}

async function loadMetro(){
  try {
    let parsed = null;
    let source = '';

    try {
      const metroGeo = await fetchJSON(`${PATHS.metro}/metro.geojson`);
      if (metroGeo && metroGeo.type === 'FeatureCollection') {
        parsed = buildMetroFromJSON(metroGeo);
        source = 'metro.geojson';
      }
    } catch (e1) {
      console.warn('[Metro] No se pudo leer metro.geojson:', e1.message);
    }

    if (!parsed) {
      const metroRaw = await fetchJSON(`${PATHS.metro}/metro.json`);
      parsed = buildMetroFromJSON(metroRaw);
      source = 'metro.json';
    }

    state.systems.metro.stops    = parsed.stops;
    state.systems.metro.services = filterByCatalogFor('metro', parsed.services, state.catalog);

    const metroIds = state.systems.metro.services.map(s => s.id);
    console.log('[Metro] Fuente:', source, '| Líneas detectadas:', metroIds.join(', ') || '-');
  } catch (e) {
    console.warn('Metro no disponible:', e.message);
    state.systems.metro.stops = new Map();
    state.systems.metro.services = [];
  }
}

/* ===========================
   Wikiroutes (solo meta)
   =========================== */

function buildWrUiAndDefsFromWrMap(wrMap){
  const routeDefs = new Map();
  const routesUi = [];

  const routesObj = wrMap?.routes && typeof wrMap.routes === 'object' ? wrMap.routes : null;
  if (!routesObj) return { routeDefs, routesUi };

  for (const [rid, conf] of Object.entries(routesObj)) {
    const folderRel = conf.folder || `route_${rid}`;
    const folder = folderRel.startsWith('data/')
      ? folderRel
      : `${PATHS.wr}/${folderRel}`;

    routeDefs.set(String(rid), {
      folder,
      color: conf.color || '#00008C',
      trip: conf.trip,
      name: conf.name || `Ruta ${rid}`
    });
  }

  const groups = new Map();
  for (const rid of Object.keys(routesObj)) {
    const m = rid.match(/^(.*?)-(ida|vuelta)$/i);
    if (m) {
      const base = m[1];
      const dir  = m[2].toLowerCase();
      if (!groups.has(base)) groups.set(base, { base, ida:null, vuelta:null });
      groups.get(base)[dir] = rid;
    } else {
      routesUi.push({
        id: rid,                              // era: only
        display_id: routesObj[rid].display_id || null,  // era: routesObj[only]
        name: routesObj[rid].name || `Ruta ${rid}`,
        color: routesObj[rid].color || '#00008C'
      });
    }
  }

  groups.forEach(g => {
    if (g.ida && g.vuelta) {
      const baseColor = (routesObj[g.ida].color || routesObj[g.vuelta].color || '#00008C');
      routesUi.push({
        id: g.base,
        display_id: routesObj[g.ida].display_id || routesObj[g.vuelta].display_id || null,
        label: routesObj[g.ida].label || routesObj[g.vuelta].label || null,
        name: routesObj[g.ida].name || `Ruta ${g.base}`,
        nameVuelta: routesObj[g.vuelta].name || null,
        color: baseColor,
        pair: { ida: g.ida, vuelta: g.vuelta }
      });
    } else {
      const only = g.ida || g.vuelta;
      if (only) {
        routesUi.push({
          id: g.base,
          display_id: routesObj[only].display_id || null,
          label: routesObj[only].label || null,
          subtitle: routesObj[only].subtitle || null,
          name: routesObj[only].name || `Ruta ${only}`,
          color: routesObj[only].color || '#00008C',
          pair: { ida: only, vuelta: null }
        });
      }
    }
  });

  // Deduplicar: si existe una entrada con id === display_id, eliminar las que comparten
  // display_id pero tienen id distinto (son sub-trips del mismo display)
  const byBaseCode = new Map();
  for (const entry of routesUi) {
    const rawId = String(entry.display_id || entry.id || '').toUpperCase();
    const baseCode = rawId.replace(/_\d+$/, '');
    const existing = byBaseCode.get(baseCode);
    if (!existing) {
      byBaseCode.set(baseCode, entry);
    } else {
      // Preferir la entrada cuyo id no tiene sufijo _NNNNN
      const entryIsClean  = !String(entry.id).match(/_\d+$/);
      const existingIsClean = !String(existing.id).match(/_\d+$/);
      if (entryIsClean && !existingIsClean) byBaseCode.set(baseCode, entry);
    }
  }
  const routesUiDeduped = Array.from(byBaseCode.values());
  return { routeDefs, routesUi: routesUiDeduped };
}

async function loadWikiroutesMeta(){
  try {
    let wrMap = await fetchJSON('pipeline/output/wr_map.json').catch(()=>null);
    if (!wrMap) wrMap = await fetchJSON(`${PATHS.data}/pipeline/output/wr_map.json`).catch(()=>null);

    state.systems.wr.routes    = [];
    state.systems.wr.routesUi  = [];
    state.systems.wr.routeDefs = new Map();

    if (wrMap?.routes && typeof wrMap.routes === 'object') {
      const { routeDefs, routesUi } = buildWrUiAndDefsFromWrMap(wrMap);
      state.systems.wr.routeDefs = routeDefs;
      state.systems.wr.routesUi  = routesUi;
      state.systems.wr.routes    = routesUi;
      console.log('[WR] UI preparada:', routesUi.length, '| defs:', routeDefs.size);
      return;
    }

    console.warn('[WR] wr_map.json no tiene routes.');
    state.systems.wr.routes    = [];
    state.systems.wr.routesUi  = [];
    state.systems.wr.routeDefs = new Map();
  } catch (e) {
    console.warn('[WR] No se pudo preparar el catálogo:', e.message);
    state.systems.wr.routes    = [];
    state.systems.wr.routesUi  = [];
    state.systems.wr.routeDefs = new Map();
  }
}

/* ===========================
   Corredores desde Wikiroutes (vista corrWr)
   =========================== */

async function loadCorrFromWikiroutes(){
  try {
    const listaCorr = await fetchJSON(PATHS.listaCorredores);
    const wrRoutes  = state.systems.wr.routes || [];
    state.corrWr = buildCorrFromWrRoutes(wrRoutes, listaCorr);

    const total = state.corrWr.services.length;
    const activos = state.corrWr.groups.principales_activas.length +
                    state.corrWr.groups.alimentadoras_activas.length;

    console.log('[Corr-WR] Rutas de corredor basadas en Wikiroutes:', total, '| activas:', activos);
  } catch (e) {
    console.warn('[Corr-WR] No se pudo construir la vista de corredores desde Wikiroutes:', e.message);
    state.corrWr = {
      services: [],
      groups: {
        principales_activas: [],
        principales_inactivas: [],
        alimentadoras_activas: [],
        alimentadoras_inactivas: []
      }
    };
  }
}

/* ===========================
   Init principal
   =========================== */

async function init(){
  initMap();

  disableSidebarChecks(true);
  setSidebarLoading(true, 'Cargando rutas y paraderos...');
  setStatus('Cargando...');

  setListPlaceholder($('#p-met-reg'), 'Cargando Metropolitano (regulares)...');
  setListPlaceholder($('#p-met-exp'), 'Cargando Metropolitano (expresos)...');
  setListPlaceholder($('#p-met-alim-n'), 'Cargando Alimentadores (Norte)...');
  setListPlaceholder($('#p-met-alim-s'), 'Cargando Alimentadores (Sur)...');
  setListPlaceholder($('#p-corr-list'), 'Cargando Corredores...');
  setListPlaceholder($('#p-metro'), 'Cargando Metro...');
  setListPlaceholder($('#p-wr'), 'Cargando Transporte público...');

  setListPlaceholder(pickFirst('#p-wr-semi-body', '#p-wr-semi'), 'Cargando Transporte semiformal...');
  setListPlaceholder(pickFirst('#p-wr-aero-body', '#p-wr-aero'), 'Cargando AeroDirecto...');
  setListPlaceholder($('#p-wr-esi'), 'Cargando Otros...');

  await nextFrame();

  await loadCatalog();

  setStatus('Cargando datos...');
  await Promise.all([
    (async () => { setStatus('Cargando Metropolitano...'); await loadMetropolitano(); })(),
    (async () => { setStatus('Cargando Alimentadores...'); await loadAlimentadores(); })(),
    (async () => { setStatus('Cargando Corredores...'); await loadCorredores(); })(),
    (async () => { setStatus('Cargando Metro...'); await loadMetro(); })(),
    (async () => { setStatus('Cargando Wikiroutes...'); await loadWikiroutesMeta(); })()
  ]);

  setStatus('Clasificando corredores desde Wikiroutes...');
  await loadCorrFromWikiroutes();

  await buildUI();

  const wr = state.systems.wr;
  if (wr && wr.layers) {
    wr.layers.forEach((layer, id) => {
      if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
      const stopSub = wr.stopLayers?.get(id);
      if (stopSub && state.map.hasLayer(stopSub)) state.map.removeLayer(stopSub);
    });
  }

  const topWr = document.getElementById('chk-wr');
  if (topWr) { topWr.checked = false; topWr.indeterminate = false; }

  const topA = document.getElementById('chk-wr-aero');
  if (topA) { topA.checked = false; topA.indeterminate = false; }

  const topO = document.getElementById('chk-wr-otros');
  if (topO) { topO.checked = false; topO.indeterminate = false; }

  $$('#p-wr-semi .item input[type="checkbox"]').forEach(chk => { chk.checked = false; });
  $$('#p-wr .item input[type="checkbox"]').forEach(chk => { chk.checked = false; });
  $$('#p-wr-aero .item input[type="checkbox"]').forEach(chk => { chk.checked = false; });
  $$('#p-wr-otros .item input[type="checkbox"]').forEach(chk => { chk.checked = false; });

  syncAllTri();
  disableSidebarChecks(false);
  setSidebarLoading(false);
  setStatus('Listo');
}

async function buildUI(){
  state.systems.met.ui   = state.systems.met.ui   || {};
  state.systems.alim.ui  = state.systems.alim.ui  || {};
  state.systems.corr.ui  = state.systems.corr.ui  || {};
  state.systems.metro.ui = state.systems.metro.ui || {};
  state.systems.wr.ui    = state.systems.wr.ui    || {};

  state.systems.corr.ui.groups = state.systems.corr.ui.groups || new Map();

  state.systems.met.ui.listReg = $('#p-met-reg');
  state.systems.met.ui.listExp = $('#p-met-exp');
  state.systems.met.ui.chkAll  = $('#chk-met');
  state.systems.met.ui.chkReg  = $('#chk-met-reg');
  state.systems.met.ui.chkExp  = $('#chk-met-exp');

  state.systems.alim.ui.listN  = $('#p-met-alim-n');
  state.systems.alim.ui.listS  = $('#p-met-alim-s');
  state.systems.alim.ui.chkAll = $('#chk-met-alim');
  state.systems.alim.ui.chkN   = $('#chk-met-alim-n');
  state.systems.alim.ui.chkS   = $('#chk-met-alim-s');

  state.systems.corr.ui.list   = $('#p-corr-list');
  state.systems.corr.ui.chkAll = $('#chk-corr');

  state.systems.metro.ui.list   = $('#p-metro');
  state.systems.metro.ui.chkAll = $('#chk-metro');

  state.systems.wr.ui.list      = $('#p-wr');
  state.systems.wr.ui.chkAll    = $('#chk-wr');

  state.systems.wr.ui.listSemi  = pickFirst('#p-wr-semi-body', '#p-wr-semi');
  state.systems.wr.ui.listAero  = pickFirst('#p-wr-aero-body', '#p-wr-aero');
  state.systems.wr.ui.chkAero   = $('#chk-wr-aero');

  state.systems.wr.ui.listOtros = $('#p-wr-esi');
  state.systems.wr.ui.chkOtros  = $('#chk-wr-otros');
  state.systems.wr.ui.chkEsi    = $('#chk-wr-esi');
  state.systems.wr.ui.chkSemi  = $('#chk-wr-semi');

  fillMetList();
  fillAlimList();
  fillCorrList();
  if (state.systems.wr.ui.listSemi) await fillSemiformalList();
  fillMetroList();

  await fillWrList();
  if (state.systems.wr.ui.listAero)  await fillAeroList();
  if (state.systems.wr.ui.listOtros) await fillOtrosList();

  wireHierarchy();

  const btnLight = $('#btnLight');
  const btnDark  = $('#btnDark');
  btnLight && btnLight.addEventListener('click', () => setBase('light'));
  btnDark  && btnDark .addEventListener('click', () => setBase('dark'));

  $$('input[name="dir"]').forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) {
        state.dir = r.value;
        reRenderVisibleSystem('met');
      }
    });
  });

  const chkStops = $('#chkStops');
  if (chkStops){
    chkStops.checked = true;
    chkStops.addEventListener('change', () => {
      state.showStops = chkStops.checked;
      reRenderVisible();
    });
  }

  const chkFit = $('#chkAutoFit');
  if (chkFit){
    chkFit.checked = true;
    chkFit.addEventListener('change', () => {
      state.autoFit = chkFit.checked;
    });
  }

  const btnClearAll = $('#btnClearAll');
  if (btnClearAll){
    btnClearAll.addEventListener('click', () => {
      bulk(() => {
        setLevel2Checked('met',  state.systems.met.ui.chkReg, false, { silentFit: true });
        setLevel2Checked('met',  state.systems.met.ui.chkExp, false, { silentFit: true });
        state.systems.met.ui.chkAll && (state.systems.met.ui.chkAll.checked = false);

        setLevel2Checked('alim', state.systems.alim.ui.chkN,  false, { silentFit: true });
        setLevel2Checked('alim', state.systems.alim.ui.chkS,  false, { silentFit: true });
        state.systems.alim.ui.chkAll && (state.systems.alim.ui.chkAll.checked = false);

        if (state.systems.corr.ui.chkAll){
          state.systems.corr.ui.chkAll.checked = false;
          onLevel1ChangeCorr();
        }

        if (state.systems.metro.ui.chkAll){
          state.systems.metro.ui.chkAll.checked = false;
          onLevel1ChangeMetro();
        }

        if (state.systems.wr.ui.chkAll){
          state.systems.wr.ui.chkAll.checked = false;
          onLevel1ChangeWr();
        }

        if (state.systems.wr.ui.chkAero){
          state.systems.wr.ui.chkAero.checked = false;
          onLevel1ChangeWrAero();
        }

        if (state.systems.wr.ui.chkOtros){
          state.systems.wr.ui.chkOtros.checked = false;
          onLevel1ChangeWrOtros();
        }

        if (state.systems.wr.ui.chkSemi){
          state.systems.wr.ui.chkSemi.checked = false;
          onLevel1ChangeWrSemi();
        }

      });
      syncAllTri();
    });
  }

  wirePanelTogglesOnce();

  setupSearch();
}

// Lanzar
init().catch(err => {
  console.error(err);
  setSidebarLoading(false);
  disableSidebarChecks(false);
  setStatus('Error al iniciar');
});
