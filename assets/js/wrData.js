import { wrCanonicalCode, wrRouteBases, wrIsVerifiedOld as isVerified, wrFilterRoutesByGroup as filterGroup } from './routePolicy.js';
export { wrCanonicalCode, wrRouteBases };
export const wrIsVerifiedOld = id => isVerified(id, state.catalog);
export const wrFilterRoutesByGroup = (group, routes) => filterGroup(group, routes, state.catalog || {});
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
        codigo_antiguo: row.codigo_antiguo || '',
        distrito_origen: row.distrito_origen || '',
        distrito_destino: row.distrito_destino || '',
        empresa_operadora: row.empresa_operadora || '',
        empresa_abrev: row.empresa_abrev || '',
        alias: row.alias || '',
        // Estado de su código antiguo en Wikipedia ('Inactiva': ya no circularía)
        estado_wikipedia: row.estado_wikipedia || '',
        // Nombre con el que la conoce la gente y empresa sin razón social
        nombre_popular: row.nombre_popular || '',
        empresa_corta: row.empresa_corta || ''
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

// Códigos con los que una ruta puede figurar en config/catalog.json:
// "1240-ida" → 1240; "1_52587" → 1_52587, 52587 y 1; "0123" → 0123 y 123
/* =========================
   Fotos referenciales (config/route_photos.json)
   ========================= */

let routePhotosPromise = null;

// { código canónico: [{imagen, pagina, autor, licencia, licencia_url, fuente, …}] }
export function loadRoutePhotos(){
  if (routePhotosPromise) return routePhotosPromise;
  routePhotosPromise = fetch('config/route_photos.json')
    .then(r => r.ok ? r.json() : { rutas: {} })
    .then(data => {
      const out = {};
      for (const [codigo, fotos] of Object.entries(data?.rutas || {})){
        // Solo enlaces https (lo valida también commons_photos.py --check)
        const ok = (fotos || []).filter(f => /^https:\/\//.test(f?.imagen || '') && /^https:\/\//.test(f?.pagina || ''));
        if (ok.length) out[wrCanonicalCode(codigo)] = ok;
      }
      return out;
    })
    .catch(() => ({}));
  return routePhotosPromise;
}
