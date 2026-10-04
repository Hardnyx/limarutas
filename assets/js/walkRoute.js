// walkRoute.js
// Camino a pie por calles, veredas, escaleras y puentes peatonales: OSRM con
// el perfil peatonal de OpenStreetMap (servidor público de FOSSGIS, para
// todo el mundo). Solo dibuja los tramos a pie del viaje elegido; el cálculo
// del viaje sigue usando la distancia en línea recta con su factor, que no
// depende de la red. Sin respuesta (sin conexión, servidor caído), el tramo
// queda en línea recta.
import { state } from './config.js';

const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
const TIMEOUT_MS = 6000;
// Más cerca que esto no hace falta buscar calles
const MIN_M = 40;
// Si el camino da más de esto veces la recta, el ruteador se fue a otra
// orilla (un río, una vía sin cruce mapeado): mejor la recta
const MAX_DETOUR = 4;

const done = new Map();      // clave → {coords, m} | null (sin camino)
const pending = new Map();   // clave → Promise
let attributed = false;

const key = (a, b) => `${a[0].toFixed(5)},${a[1].toFixed(5)};${b[0].toFixed(5)},${b[1].toFixed(5)}`;

function straightM(a, b){
  const k = Math.cos(a[0] * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * 110_574, (a[1] - b[1]) * 111_320 * k);
}

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const url = `${ROUTER}${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
  const p = fetch(url, { signal: ctrl.signal })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      const route = j?.code === 'Ok' && j.routes?.[0];
      const line = route?.geometry?.coordinates;
      if (!line || line.length < 2 || route.distance > MAX_DETOUR * straightM(a, b) + 200) return null;
      // Desde el punto exacto (el ruteador parte de la calle más cercana)
      return { coords: [a, ...line.map(([lon, lat]) => [lat, lon]), b], m: route.distance };
    })
    .catch(() => null)
    .then(res => {
      clearTimeout(timer);
      done.set(k, res);
      pending.delete(k);
      if (res && !attributed && state.map?.attributionControl){
        state.map.attributionControl.addAttribution(
          'Caminos a pie: <a href="https://routing.openstreetmap.de/" target="_blank" rel="noopener">OSRM · FOSSGIS</a>');
        attributed = true;
      }
      return res;
    });
  pending.set(k, p);
  return p;
}
