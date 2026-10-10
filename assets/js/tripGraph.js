// Pure graph assembly and spatial lookup.
import { runsAt } from './metSchedule.js';
import { distM, M_LAT, M_LON } from './geo.js';
export const WALK_MAX_M = 400;
const cellOf = (lat, lon) => [Math.floor(lat * M_LAT / WALK_MAX_M), Math.floor(lon * M_LON / WALK_MAX_M)];

export function buildTripGraph(raw, catalog){
  const n = raw.stops.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const name = new Array(n);
  const district = new Array(n);
  // Cruce para buscar ("Universitaria con Colonial"), el mismo empezando por
  // la otra calle ("Colonial con Universitaria") y otros nombres ("Trébol de
  // Javier Prado", "Óscar R. Benavides"); el nombre no cambia
  const cross = new Array(n);
  const swap = new Array(n);
  const alias = new Array(n);
  raw.stops.forEach(([a, b, nm, d, cr, sw, al], i) => {
    lat[i] = a; lon[i] = b; name[i] = nm; district[i] = raw.districts[d] || '';
    cross[i] = cr || ''; swap[i] = sw || ''; alias[i] = al != null ? (raw.aliases?.[al] || '') : '';
  });

  // Rutas que están en el sidebar
  const routes = [];
  for (const [key, seq] of Object.entries(raw.routes)){
    const service = catalog.routeFor(key);
    if (!service) continue;
    routes.push({
      ...service,
      key,
      // Metros por la vía entre paraderos consecutivos (Metropolitano)
      segM: raw.segM?.[key] || null,
      // Minutos entre buses según la ficha técnica del PRR (sin horario)
      headway: raw.headway?.[key] ?? null,
      // % extra de cada tramo en hora punta por avenidas congestionadas
      // (config/congestion.json); el Metropolitano y el Metro no tienen
      slow: raw.slow?.[key] || null,
      stops: Int32Array.from(seq)
    });
  }

  // Rutas que pasan por cada paradero: [índice de ruta, posición en ella]
  const atStop = Array.from({ length: n }, () => []);
  routes.forEach((r, ri) => r.stops.forEach((s, pos) => atStop[s].push([ri, pos])));

  // Grilla para vecinos: celdas del tamaño de la caminata máxima
  const grid = new Map();
  for (let i = 0; i < n; i++){
    const [cy, cx] = cellOf(lat[i], lon[i]);
    const k = `${cy},${cx}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  function around(la, lo, maxM){
    const r = Math.ceil(maxM / WALK_MAX_M);
    const [cy, cx] = cellOf(la, lo);
    const out = [];
    for (let dy = -r; dy <= r; dy++){
      for (let dx = -r; dx <= r; dx++){
        const cell = grid.get(`${cy + dy},${cx + dx}`);
        if (!cell) continue;
        for (const j of cell){
          const d = distM(la, lo, lat[j], lon[j]);
          if (d <= maxM) out.push([j, d]);
        }
      }
    }
    return out.sort((a, b) => a[1] - b[1]);
  }

  const walkCache = new Map();

  return {
    stops: { lat, lon, name, district, cross, swap, alias, count: n },
    routes,
    atStop,

    // Rutas para calcular: las antiguas sin revisar solo si se piden; con
    // at = { day, min } (hora de Lima), solo lo que circula a esa hora
    activeRoutes({ includeOld = false, at = null } = {}){
      return routes.filter(r => (r.group !== 'antigua' || r.verified || includeOld) &&
        (!at || !r.schedule || runsAt(r.schedule, at)));
    },

    // Paraderos a los que se puede caminar desde i: [[j, metros], ...]
    walkFrom(i){
      if (!walkCache.has(i)) walkCache.set(i, around(lat[i], lon[i], WALK_MAX_M).filter(([j]) => j !== i));
      return walkCache.get(i);
    },

    // Paraderos cerca de un punto (origen o destino), del más cercano al más lejano
    nearestStops(la, lo, maxM = 800){
      return around(la, lo, maxM);
    }
  };
}
