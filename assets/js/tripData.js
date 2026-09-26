// tripData.js
// Datos para calcular viajes ("Cómo llegar"): paraderos, rutas con sus
// paraderos en orden y caminatas entre paraderos cercanos.
//
// pipeline/output/trip_graph.json (build_trip_graph.py) trae solo datos
// físicos. Qué rutas se ofrecen y de qué grupo son sale de las casillas del
// sidebar: una capa sin casilla (fuera del catálogo) no entra.
//
// Paraderos distintos muy cercanos (vía principal y auxiliar, los dos lados
// de la pista) no se juntan: se unen con caminatas cortas (walkFrom).
import { wrLeafFor } from './routeEntries.js';
import { wrIsVerifiedOld } from './wrData.js';

const GRAPH_URL = 'pipeline/output/trip_graph.json';

// Hasta cuánto se camina para hacer transbordo entre paraderos (metros en
// línea recta; la caminata real es algo más larga)
export const WALK_MAX_M = 400;

// Grupo de cada lista del sidebar
export const TRIP_GROUPS = {
  wr: 'atu',            // Transporte público
  corr: 'corredor',
  wrAero: 'aero',
  wrOtros: 'otros',
  wrSemi: 'antigua',    // Rutas antiguas
  met: 'metropolitano',
  metro: 'metro'
};

/* =========================
   Distancias y grilla
   ========================= */

const M_LAT = 110_574;
const M_LON = 111_320 * Math.cos(-12.05 * Math.PI / 180);   // Lima

export function distM(lat1, lon1, lat2, lon2){
  return Math.hypot((lon1 - lon2) * M_LON, (lat1 - lat2) * M_LAT);
}

const cellOf = (lat, lon) => [Math.floor(lat * M_LAT / WALK_MAX_M), Math.floor(lon * M_LON / WALK_MAX_M)];

/* =========================
   Casilla de cada ruta
   ========================= */

// "met:A:ns" → casilla de Metropolitano A; "metro:L1:0" → Línea 1;
// el resto son capas Wikiroutes ("1240-ida")
function leafFor(key){
  const m = key.match(/^(met|metro):(.+):[^:]+$/);
  if (m){
    return document.querySelector(
      `#panels .item .item-head input[data-system="${m[1]}"][data-id="${CSS.escape(m[2])}"]`);
  }
  return wrLeafFor(key);
}

function codeOf(leaf, key){
  const tag = leaf.closest('.item')?.querySelector('.item-head .left .tag, .item-head .left .badge');
  const text = tag?.textContent?.trim();
  return text || leaf.dataset.id || key;
}

/* =========================
   Carga
   ========================= */

let graphPromise = null;

// { force } vuelve a leer el catálogo (p. ej. tras cambiar "verificadas")
export function loadTripGraph({ force = false } = {}){
  if (force) graphPromise = null;
  if (!graphPromise){
    graphPromise = fetch(GRAPH_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} - ${GRAPH_URL}`); return r.json(); })
      .then(buildTripGraph)
      .catch(err => { graphPromise = null; throw err; });
  }
  return graphPromise;
}

export function buildTripGraph(raw){
  const n = raw.stops.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const name = new Array(n);
  const district = new Array(n);
  raw.stops.forEach(([a, b, nm, d], i) => {
    lat[i] = a; lon[i] = b; name[i] = nm; district[i] = raw.districts[d] || '';
  });

  // Rutas que están en el sidebar
  const routes = [];
  for (const [key, seq] of Object.entries(raw.routes)){
    const leaf = leafFor(key);
    if (!leaf) continue;
    const system = leaf.dataset.system;
    const group = TRIP_GROUPS[system];
    if (!group) continue;
    routes.push({
      key,
      leaf,
      system,
      group,
      // Rutas antiguas: ¿revisada y sigue circulando?
      verified: group === 'antigua' ? wrIsVerifiedOld(leaf.dataset.id) : true,
      code: codeOf(leaf, key),
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
    stops: { lat, lon, name, district, count: n },
    routes,
    atStop,

    // Rutas para calcular: las antiguas sin revisar solo si se piden
    activeRoutes({ includeOld = false } = {}){
      return routes.filter(r => r.group !== 'antigua' || r.verified || includeOld);
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
