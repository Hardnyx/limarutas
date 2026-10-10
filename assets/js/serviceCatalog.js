import { wrCanonicalCode, wrFilterRoutesByGroup, wrIsVerifiedOld } from './routePolicy.js';
import { createCorridorPolicy, corrServiceCodeOf, CORR_KEY_LABEL } from './corridorPolicy.js';
import { wrChipName, wrBuildTituloPrincipal } from './wrTexts.js';

export const TRIP_GROUPS = Object.freeze({
  wr: 'atu', corr: 'corredor', wrAero: 'aero', wrOtros: 'otros',
  wrSemi: 'antigua', met: 'metropolitano', alim: 'alimentador', metro: 'metro'
});
export const serviceIdFor = (system, id) => `${system}:${String(id)}`;
const sideId = side => side && String(typeof side === 'object' ? side.id : side);

// Sources are already parsed and filtered for the fixed systems by the loader.
// Layer identity belongs to the data, independently of checkbox lifetimes.
export function createServiceCatalog({ systems, catalog = {}, corridors = [], metadata = {} }){
  const services = new Map();
  const byLayer = new Map();
  const policy = createCorridorPolicy(catalog);
  function add(system, source){
    const id = String(source.id);
    const serviceId = serviceIdFor(system, id);
    const group = TRIP_GROUPS[system];
    const isWr = system.startsWith('wr');
    const meta = isWr ? metadata[wrCanonicalCode(id)] : null;
    const code = system === 'corr' ? corrServiceCodeOf(source) :
      isWr ? String(source.display_id || id).toUpperCase() : system === 'alim' ? id.toUpperCase() : id;
    const pair = source.pair || (source.ida && source.vuelta ? { ida: source.ida, vuelta: source.vuelta } : null);
    const ida = sideId(pair?.ida), vuelta = sideId(pair?.vuelta);
    const entry = {
      serviceId, system, id, group, code,
      alias: wrChipName(meta), metadata: meta,
      name: isWr ? wrBuildTituloPrincipal(meta, source) : system === 'metro' ? `Línea ${id.toUpperCase()}` :
        source.name || (system === 'met' ? `${source.kind === 'regular' ? 'Ruta' : source.kind === 'expreso' ? 'Expreso' : 'Servicio'} ${id}` : `Alimentador ${code}`),
      color: system === 'corr' ? policy.color(code) || source.corrColor || source.color || '#10b981' : source.color || '#3b82f6',
      corridorName: system === 'corr' ? CORR_KEY_LABEL[policy.groupKey(code)] || 'Corredor' : '',
      verified: group !== 'antigua' || wrIsVerifiedOld(id, catalog),
      schedule: source.schedule || null,
      paths: system === 'alim' ? systems.alim.paths?.[id] : null,
      pair: ida && vuelta ? { ida, vuelta } : null,
      layer: isWr && !(ida && vuelta) ? ida || id : null,
      defaultDirection: source.defaultDir || (system === 'alim' ? 'sur' : isWr || system === 'corr' ? 'ida' : 'ambas')
    };
    services.set(serviceId, entry);
    if (entry.pair) for (const layer of [ida, vuelta]) if (!byLayer.has(layer)) byLayer.set(layer, entry);
  }
  for (const system of ['met', 'alim', 'metro']) for (const source of systems[system]?.services || []) add(system, source);
  for (const source of policy.filter(corridors.length ? corridors : systems.corr?.services)) add('corr', source);
  const wrRoutes = systems.wr?.routesUi || systems.wr?.routes || [];
  for (const [system, group] of [['wr', 'transporte'], ['wrAero', 'aerodirecto'], ['wrOtros', 'expreso_san_isidro'], ['wrSemi', 'semiformal']]){
    for (const source of wrFilterRoutesByGroup(group, wrRoutes, catalog)) add(system, source);
  }
  return {
    services,
    get: (system, id) => services.get(serviceIdFor(system, id)) || null,
    routeFor(key){
      const fixed = key.match(/^(met|metro|alim):(.+):([^:]+)$/);
      if (fixed){
        const entry = services.get(serviceIdFor(fixed[1], fixed[2]));
        return entry ? { ...entry, direction: fixed[3], schedule: entry.schedule?.[fixed[3]] || null, headsign: entry.paths?.[fixed[3]]?.to || '' } : null;
      }
      let entry = byLayer.get(key);
      if (!entry){
        const base = String(key).replace(/-(ida|vuelta)$/i, '');
        for (const system of ['wr', 'corr', 'wrAero', 'wrOtros', 'wrSemi']){
          entry = services.get(serviceIdFor(system, base));
          if (entry) break;
        }
      }
      return entry ? { ...entry, direction: key.match(/-(ida|vuelta)$/i)?.[1]?.toLowerCase() || '', schedule: null, headsign: '' } : null;
    }
  };
}
