// wrData.js
// Datos de Wikiroutes para el sidebar: metadata del CSV maestro, extremos
// (paradero inicial/final) y filtro de rutas por grupo del catálogo.
import { state } from './config.js';
import { parseCsvRows } from './utils.js';

/* =========================
   Wikiroutes: carga de metadata y extremos
   ========================= */

let wrListaMetaPromise = null;
let wrExtremesPromise = null;

export function wrCanonicalCode(value){
  const s = String(value || '').trim();
  if (!s) return '';
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n);
  return s.toUpperCase();
}

let maestroRowsPromise = null;

// Filas de lista_rutas_maestro.csv (se descarga una sola vez)
export function loadMaestroRows(){
  if (maestroRowsPromise) return maestroRowsPromise;

  maestroRowsPromise = fetch('pipeline/output/lista_rutas_maestro.csv')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then(parseCsvRows)
    .catch(err => {
      console.error('No se pudo cargar pipeline/output/lista_rutas_maestro.csv', err);
      return [];
    });

  return maestroRowsPromise;
}

// Metadata por código canónico (1001, "IO32B"...) para los ítems del sidebar
export function loadWrListaMeta(){
  if (wrListaMetaPromise) return wrListaMetaPromise;

  wrListaMetaPromise = loadMaestroRows().then(rows => {
    const metaByCodigo = {};
    for (const row of rows){
      const codigo = row.codigo_nuevo || '';
      if (!codigo) continue;
      metaByCodigo[wrCanonicalCode(codigo)] = {
        codigo_nuevo: codigo,
        distrito_origen: row.distrito_origen || '',
        distrito_destino: row.distrito_destino || '',
        empresa_operadora: row.empresa_operadora || '',
        alias: row.alias || ''
      };
    }
    return metaByCodigo;
  });

  return wrListaMetaPromise;
}

export function loadWrExtremes(){
  if (wrExtremesPromise) return wrExtremesPromise;

  wrExtremesPromise = fetch('pipeline/output/wr_extremes.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(err => {
      console.error('No se pudo cargar pipeline/output/wr_extremes.json', err);
      return {};
    });

  return wrExtremesPromise;
}

/* =========================
   Filtrado por grupo (catalog.json)
   ========================= */

export function wrFilterRoutesByGroup(groupName, routes){
  const catalog = state.catalog || {};
  const upper = s => String(s).toUpperCase().trim();

  let cfg = null;
  if (groupName === 'transporte'){
    cfg = catalog.transporte || null;
  } else if (groupName === 'aerodirecto'){
    cfg = catalog.aerodirecto || null;
  } else if (groupName === 'expreso_san_isidro'){
    cfg = (catalog.otros && catalog.otros.expreso_san_isidro) || null;
  } else if (groupName === 'semiformal'){
    cfg = catalog.semiformal || null;
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
