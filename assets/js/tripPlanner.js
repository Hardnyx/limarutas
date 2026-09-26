// tripPlanner.js
// Cálculo de viajes de A a B sobre el grafo de tripData.js: directos y con
// un transbordo. Sin horarios ni frecuencias, las opciones se ordenan por
// menos transbordos y, entre ellas, por menos tiempo estimado (paraderos
// recorridos y caminata). Los tiempos son aproximados.
import { distM } from './tripData.js';

// Hasta cuánto se camina al inicio y al final del viaje
export const ACCESS_MAX_M = 800;
// Más cerca que esto, conviene caminar
export const WALK_ONLY_M = 600;

const WALK_M_PER_MIN = 75;      // caminando, con cruces
const BUS_M_PER_MIN = 250;      // ~15 km/h con paradas y tráfico
const FAST_M_PER_MIN = 500;     // Metro y Metropolitano (vía exclusiva)
const DETOUR = 1.3;             // la caminata real es más larga que la recta
const TRANSFER_MIN = 5;         // espera y cambio
const MAX_OPTIONS = 3;

const walkMin = m => (m * DETOUR) / WALK_M_PER_MIN;

// Minutos del tramo k → k+1 de una ruta (se calculan una vez por ruta)
const legCache = new WeakMap();
function legMin(g, r, k){
  let legs = legCache.get(r);
  if (!legs){
    const { lat, lon } = g.stops;
    const speed = (r.group === 'metro' || r.group === 'metropolitano') ? FAST_M_PER_MIN : BUS_M_PER_MIN;
    legs = new Float32Array(Math.max(0, r.stops.length - 1));
    for (let i = 0; i < legs.length; i++){
      const a = r.stops[i], b = r.stops[i + 1];
      legs[i] = distM(lat[a], lon[a], lat[b], lon[b]) / speed;
    }
    legCache.set(r, legs);
  }
  return legs[k];
}

// Tramos de una opción: caminar, subir, (caminar,) subir, caminar
function legsOf(g, c){
  const r1 = g.routes[c.r1];
  const legs = [
    { type: 'walk', m: c.walkA, to: c.o },
    { type: 'ride', route: r1, from: c.p, to: c.k }
  ];
  if (c.transfers){
    if (c.walkT > 0) legs.push({ type: 'walk', m: c.walkT, from: c.x, to: c.y });
    const r2 = g.routes[c.r2];
    legs.push({ type: 'ride', route: r2, from: c.e.from, to: c.e.to });
    legs.push({ type: 'walk', m: c.e.walkB, from: r2.stops[c.e.to] });
  } else {
    legs.push({ type: 'walk', m: c.walkB, from: r1.stops[c.k] });
  }
  return legs;
}

// Mismo servicio (ida y vuelta de una ruta, o sus dos sentidos)
const sameService = (a, b) => a.leaf === b.leaf;

/**
 * Planifica un viaje.
 * @param g      grafo de loadTripGraph()
 * @param from   {lat, lon}
 * @param to     {lat, lon}
 * @param opts   { includeOld }
 * @returns { walkOnly, meters, options: [{ legs, minutes, transfers, walkM, old }] }
 */
export function planTrip(g, from, to, { includeOld = false } = {}){
  const direct = distM(from.lat, from.lon, to.lat, to.lon);
  const out = { walkOnly: direct <= WALK_ONLY_M, meters: direct, options: [] };
  if (out.walkOnly) return out;

  const active = new Set(g.activeRoutes({ includeOld }));
  const isActive = i => active.has(g.routes[i]);

  const origins = g.nearestStops(from.lat, from.lon, ACCESS_MAX_M);
  const dests = new Map(g.nearestStops(to.lat, to.lon, ACCESS_MAX_M));
  if (!origins.length || !dests.size) return out;

  // Mejor forma de terminar desde cada paradero: subir a una ruta ahí y
  // bajar cerca del destino. toDest: paradero → Map(índice de ruta → { from, to, min, walkB })
  const toDest = new Map();
  for (const [d, walkB] of dests){
    for (const [rIdx, q] of g.atStop[d]){
      if (!isActive(rIdx)) continue;
      const r = g.routes[rIdx];
      let min = walkMin(walkB);
      for (let k = q - 1; k >= 0; k--){
        min += legMin(g, r, k);
        const y = r.stops[k];
        let byRoute = toDest.get(y);
        if (!byRoute){ byRoute = new Map(); toDest.set(y, byRoute); }
        const cur = byRoute.get(rIdx);
        if (!cur || min < cur.min) byRoute.set(rIdx, { from: k, to: q, min, walkB });
      }
    }
  }

  // Mejor candidato por combinación de rutas ("r1" o "r1>r2")
  const best = new Map();
  const keep = (key, cand) => {
    const cur = best.get(key);
    if (!cur || cand.minutes < cur.minutes) best.set(key, cand);
  };

  for (const [o, walkA] of origins){
    const head = walkMin(walkA);
    for (const [rIdx, p] of g.atStop[o]){
      if (!isActive(rIdx)) continue;
      const r1 = g.routes[rIdx];
      let ride1 = 0;

      for (let k = p + 1; k < r1.stops.length; k++){
        ride1 += legMin(g, r1, k - 1);
        const x = r1.stops[k];

        // Directo: bajar cerca del destino
        const walkB = dests.get(x);
        if (walkB != null){
          keep(`${rIdx}`, {
            transfers: 0, minutes: head + ride1 + walkMin(walkB), walkM: walkA + walkB,
            r1: rIdx, o, p, k, walkA, walkB
          });
        }

        // Un transbordo: en el mismo paradero o caminando a uno cercano
        const hops = [[x, 0], ...g.walkFrom(x)];
        for (const [y, walkT] of hops){
          const ends = toDest.get(y);
          if (!ends) continue;
          const base = head + ride1 + walkMin(walkT) + TRANSFER_MIN;
          for (const [r2Idx, e] of ends){
            if (sameService(g.routes[r2Idx], r1)) continue;
            keep(`${rIdx}>${r2Idx}`, {
              transfers: 1, minutes: base + e.min, walkM: walkA + walkT + e.walkB,
              r1: rIdx, o, p, k, walkA, x, y, walkT, r2: r2Idx, e
            });
          }
        }
      }
    }
  }

  const found = Array.from(best.values(), c => ({ ...c, legs: legsOf(g, c) }));

  // Menos transbordos primero; luego menos tiempo. Una opción por
  // combinación de rutas (la mejor), hasta MAX_OPTIONS, y las directas antes
  found.sort((a, b) => a.transfers - b.transfers || a.minutes - b.minutes);
  const seen = new Set();
  for (const opt of found){
    const rides = opt.legs.filter(l => l.type === 'ride');
    // Misma combinación de servicios (p. ej. la ida de una y la vuelta de otra): una sola
    const svcKey = rides.map(l => `${l.route.leaf.dataset.system}:${l.route.leaf.dataset.id}`).join('>');
    if (seen.has(svcKey)) continue;
    seen.add(svcKey);
    out.options.push({
      legs: opt.legs,
      transfers: opt.transfers,
      minutes: Math.round(opt.minutes),
      walkM: Math.round(opt.walkM),
      old: rides.some(l => l.route.group === 'antigua')
    });
    if (out.options.length >= MAX_OPTIONS) break;
  }
  return out;
}

// Cuántas opciones más aparecerían con las rutas antiguas (para ofrecerlas)
export function oldWouldHelp(g, from, to){
  const withOld = planTrip(g, from, to, { includeOld: true });
  return withOld.options.some(o => o.old);
}

