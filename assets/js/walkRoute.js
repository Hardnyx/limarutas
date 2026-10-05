// walkRoute.js
// Camino a pie por veredas, cruces, escaleras, puentes peatonales y calles:
// la red peatonal de OpenStreetMap que arma pipeline/scripts/osm/build_walk_graph.py
// (sin ciclovías, sin la vía del Metropolitano, sin pasar por dentro de las
// estaciones). Está en cuadrículas: se cargan solo las de la zona del tramo.
// Solo dibuja los tramos a pie del viaje elegido; el cálculo del viaje sigue
// usando la distancia en línea recta con su factor. Sin camino (fuera de la
// red, sin conexión), el tramo queda en línea recta.

const BASE = 'data/processed/caminata/';
// Más cerca que esto no hace falta buscar calles
const MIN_M = 40;
// El punto de partida o llegada: a la vía más cercana, hasta esto
const SNAP_M = 200;
// Cuadrículas alrededor del tramo: el camino puede rodear hasta esto
const MARGIN_DEG = 0.005;
// Si el camino da más de esto veces la recta, la red no tiene el cruce
// (un río, una vía sin puente mapeado): mejor la recta
const MAX_DETOUR = 4;

const M_LAT = 110_574;
const M_LON = 111_320 * Math.cos(-12.05 * Math.PI / 180);

const done = new Map();      // clave → {coords, m} | null (sin camino)
const pending = new Map();   // clave → Promise

const key = (a, b) => `${a[0].toFixed(5)},${a[1].toFixed(5)};${b[0].toFixed(5)},${b[1].toFixed(5)}`;

function straightM(a, b){
  return Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON);
}

// ---------- La red, por cuadrículas ----------
let metaPromise = null;
const tilePromises = new Map();     // 'ti_tj' → Promise
const graph = {
  nodeId: new Map(),     // 'lat,lon' (enteros) → índice
  adj: [],               // índice → [arista, ...]
  edges: [],             // {a, b, cost, geom: [[lat, lon], ...], tile}
  seen: new Set(),
  byTile: new Map(),     // 'ti_tj' → [arista, ...]
};

function meta(){
  if (!metaPromise){
    metaPromise = fetch(`${BASE}meta.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(m => m && { ...m, have: new Set(m.tiles) })
      .catch(() => null);
  }
  return metaPromise;
}

function node(lat, lon){
  const k = `${lat},${lon}`;
  let i = graph.nodeId.get(k);
  if (i === undefined){
    i = graph.adj.length;
    graph.nodeId.set(k, i);
    graph.adj.push([]);
  }
  return i;
}

function addTile(name, rows, q){
  const list = [];
  for (const row of rows){
    const sig = row.join(',');
    if (graph.seen.has(sig)) continue;     // la misma arista, de la cuadrícula vecina
    graph.seen.add(sig);
    let lat = row[1], lon = row[2];
    const ints = [[lat, lon]];
    for (let i = 3; i < row.length; i += 2){
      lat += row[i]; lon += row[i + 1];
      ints.push([lat, lon]);
    }
    const a = node(...ints[0]);
    const b = node(...ints[ints.length - 1]);
    const geom = ints.map(([y, x]) => [y / q, x / q]);
    const e = { a, b, cost: row[0] / 10, geom };
    graph.edges.push(e);
    graph.adj[a].push(e);
    graph.adj[b].push(e);
    list.push(e);
  }
  graph.byTile.set(name, list);
}

function loadTile(name, q){
  if (!tilePromises.has(name)){
    tilePromises.set(name, fetch(`${BASE}t/${name}.json`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => addTile(name, rows, q))
      .catch(() => { tilePromises.delete(name); }));
  }
  return tilePromises.get(name);
}

function tilesFor(a, b, m){
  const s = Math.min(a[0], b[0]) - MARGIN_DEG, n = Math.max(a[0], b[0]) + MARGIN_DEG;
  const w = Math.min(a[1], b[1]) - MARGIN_DEG, e = Math.max(a[1], b[1]) + MARGIN_DEG;
  const out = [];
  for (let i = Math.floor(s / m.tile); i <= Math.floor(n / m.tile); i++){
    for (let j = Math.floor(w / m.tile); j <= Math.floor(e / m.tile); j++){
      const name = `${i}_${j}`;
      if (m.have.has(name)) out.push(name);
    }
  }
  return out;
}

// ---------- Ruteo ----------
const segLen = (p, q) => Math.hypot((p[0] - q[0]) * M_LAT, (p[1] - q[1]) * M_LON);

// La vía más cercana a p: {e, k (tramo de la forma), t (fracción), q (punto), d}
function snap(p, tiles){
  let best = null;
  for (const name of tiles){
    for (const e of graph.byTile.get(name) || []){
      const g = e.geom;
      for (let k = 0; k < g.length - 1; k++){
        const ax = (g[k][1] - p[1]) * M_LON, ay = (g[k][0] - p[0]) * M_LAT;
        const bx = (g[k + 1][1] - p[1]) * M_LON, by = (g[k + 1][0] - p[0]) * M_LAT;
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (!best || d < best.d){
          best = { e, k, t, d, q: [g[k][0] + (g[k + 1][0] - g[k][0]) * t, g[k][1] + (g[k + 1][1] - g[k][1]) * t] };
        }
      }
    }
  }
  return best && best.d <= SNAP_M ? best : null;
}

function geomLen(g){
  let m = 0;
  for (let i = 1; i < g.length; i++) m += segLen(g[i - 1], g[i]);
  return m;
}

// Del punto proyectado hacia cada extremo de su arista: [forma hacia a, forma hacia b]
function splitAt(s){
  const g = s.e.geom;
  const toA = [s.q, ...g.slice(0, s.k + 1).reverse()];
  const toB = [s.q, ...g.slice(s.k + 1)];
  return [toA, toB];
}

class Heap {
  constructor(){ this.h = []; }
  push(c, v){
    const h = this.h; h.push([c, v]);
    let i = h.length - 1;
    while (i > 0){
      const p = (i - 1) >> 1;
      if (h[p][0] <= h[i][0]) break;
      [h[p], h[i]] = [h[i], h[p]]; i = p;
    }
  }
  pop(){
    const h = this.h; const top = h[0]; const last = h.pop();
    if (h.length){
      h[0] = last;
      let i = 0;
      for (;;){
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l][0] < h[m][0]) m = l;
        if (r < h.length && h[r][0] < h[m][0]) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]]; i = m;
      }
    }
    return top;
  }
  get size(){ return this.h.length; }
}

// Camino más barato de a a b por la red cargada: [[lat, lon], ...] o null
export function route(a, b, tiles){
  const sa = snap(a, tiles), sb = snap(b, tiles);
  if (!sa || !sb) return null;
  const k = e => e.cost / Math.max(1, geomLen(e.geom));      // costo por metro de la arista
  const [aToA, aToB] = splitAt(sa);
  const [bToA, bToB] = splitAt(sb);
  // Misma arista: por ella directamente
  let direct = null;
  if (sa.e === sb.e){
    const g = sa.e.geom;
    const fa = sa.k + sa.t, fb = sb.k + sb.t;
    const mid = fa <= fb ? g.slice(sa.k + 1, sb.k + 1) : g.slice(sb.k + 1, sa.k + 1).reverse();
    direct = [sa.q, ...mid, sb.q];
  }
  const dist = new Map(), prev = new Map();
  const heap = new Heap();
  const start = [[sa.e.a, geomLen(aToA) * k(sa.e)], [sa.e.b, geomLen(aToB) * k(sa.e)]];
  for (const [n, c] of start){
    if (c < (dist.get(n) ?? Infinity)){ dist.set(n, c); heap.push(c, n); }
  }
  const goal = new Map([[sb.e.a, geomLen(bToA) * k(sb.e)], [sb.e.b, geomLen(bToB) * k(sb.e)]]);
  let bestEnd = null, bestCost = direct ? geomLen(direct) * k(sa.e) : Infinity;
  while (heap.size){
    const [c, u] = heap.pop();
    if (c > dist.get(u)) continue;
    if (c >= bestCost) break;
    if (goal.has(u) && c + goal.get(u) < bestCost){ bestCost = c + goal.get(u); bestEnd = u; }
    for (const e of graph.adj[u]){
      const v = e.a === u ? e.b : e.a;
      const nc = c + e.cost;
      if (nc < (dist.get(v) ?? Infinity)){
        dist.set(v, nc); prev.set(v, e); heap.push(nc, v);
      }
    }
  }
  if (bestEnd === null) return direct;
  // De la llegada hacia atrás
  const parts = [];
  let u = bestEnd;
  while (prev.has(u)){
    const e = prev.get(u);
    parts.push(e.b === u ? e.geom : [...e.geom].reverse());
    u = e.a === u ? e.b : e.a;
  }
  const head = (u === sa.e.a ? aToA : aToB);           // del punto de partida a su nodo
  const tail = (bestEnd === sb.e.a ? bToA : bToB).slice().reverse();
  const out = [...head];
  for (const g of parts.reverse()) out.push(...g.slice(1));
  out.push(...tail.slice(1));
  return out;
}

// ---------- API ----------
// Lo ya resuelto: {coords, m}, null (sin camino) o undefined (no se pidió)
export function walkCached(a, b){
  if (straightM(a, b) < MIN_M) return null;
  return done.get(key(a, b));
}

// Pide el camino a pie de a a b ([lat, lon]); resuelve con {coords, m} o null
export function walkRoute(a, b){
  const k = key(a, b);
  if (done.has(k)) return Promise.resolve(done.get(k));
  if (straightM(a, b) < MIN_M) return Promise.resolve(null);
  if (pending.has(k)) return pending.get(k);
  const p = meta()
    .then(async m => {
      if (!m) return null;
      const tiles = tilesFor(a, b, m);
      if (!tiles.length) return null;
      await Promise.all(tiles.map(t => loadTile(t, m.q)));
      const line = route(a, b, tiles);
      if (!line || line.length < 2) return null;
      const coords = [a, ...line, b];
      const len = geomLen(coords);
      if (len > MAX_DETOUR * straightM(a, b) + 200) return null;
      return { coords, m: len };
    })
    .catch(() => null)
    .then(res => {
      done.set(k, res);
      pending.delete(k);
      return res;
    });
  pending.set(k, p);
  return p;
}
