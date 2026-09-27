// tripPlanner.js
// Cálculo de viajes de A a B sobre el grafo de tripData.js: directos y con
// un transbordo. Del Metropolitano solo entra lo que circula a la hora de
// salida (tiene horarios); sin frecuencias, se ordenan por un costo que
// suma el tiempo estimado, la caminata (pesa doble), los transbordos y la
// espera, que es menor cuando varias rutas hacen el mismo tramo. Cada tramo
// trae esas rutas alternativas: basta tomar la primera que pase.
import { runsAt } from './metSchedule.js';
import { distM } from './tripData.js';

// Hasta cuánto se camina al inicio y al final del viaje
export const ACCESS_MAX_M = 800;
// En una ruta única se acepta caminar más en un extremo (hay quien prefiere
// caminar 15 min antes que transbordar); su costo lo refleja
export const DIRECT_ACCESS_MAX_M = 1300;
// Más cerca que esto, conviene caminar
export const WALK_ONLY_M = 600;

const WALK_M_PER_MIN = 75;      // caminando, con cruces
const BUS_M_PER_MIN = 250;      // ~15 km/h con paradas y tráfico
const FAST_M_PER_MIN = 500;     // Metro y Metropolitano (vía exclusiva)
const DETOUR = 1.3;             // la caminata real es más larga que la recta
const TRANSFER_MIN = 3;         // bajar y cruzar hasta el otro paradero
const MAX_OPTIONS = 6;

// Para ordenar (no se muestran como minutos)
const WALK_WEIGHT = 2;          // un minuto a pie "cuesta" como dos
const TRANSFER_PENALTY = 20;    // bajarse, cruzar y esperar otro bus sin saber cuándo pasa
const WAIT_MIN = 10;            // espera de una sola ruta; con N que sirven, 10/(1+N)
const TOP_FOR_ALTS = 60;        // candidatos a los que se buscan alternativas
const ALT_M = 150;              // alternativas: suben y bajan a esta distancia o menos
const MAX_ALTS = 8;
const DIRECT_MAX_RATIO = 1.5;
const TRANSFER_WALK_EXTRA = 1;  // la caminata del transbordo (cruzar la avenida) pesa triple
const EASY_DIRECT_WALK_M = 800; // directo "cómodo": hasta esto a pie en total…
const MIN_LEG_STOPS = 3;        // con transbordo, cada tramo recorre al menos esto
const MAX_SAME_START = 2;       // opciones con transbordo que empiezan con las mismas rutas
const TRANSFER_MUST_SAVE_MIN = 20; // …va antes que un transbordo que no ahorre al menos esto
const TRANSFER_MUST_SAVE_SHARE = 0.2; // …ni el 20 % del tiempo del directo
// Metro, Metropolitano y corredores: más frecuentes y previsibles; se prefieren
const MASS_GROUPS = new Set(['metro', 'metropolitano', 'corredor']);
const MASS_RIDE_FACTOR = 0.8;   // su tiempo a bordo "cuesta" menos
const MASS_WAIT_MIN = 4;        // pasan seguido
const MASS_MAX_RATIO = 1.8;
const MASS_MIN_SHARE = 0.4;     // …y que al menos el 40 % del tiempo a bordo sea en ellos     // una opción con ellos se muestra si cuesta hasta 1,8 veces la mejor   // un directo se muestra si "cuesta" hasta 1,5 veces la mejor
const DOMINATED_SAVING_MIN = 10; // un transbordo con una ruta que ya va directo debe ahorrar esto

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
      // Por la vía si se conoce (Metropolitano); si no, en línea recta
      const m = r.segM?.[i] ?? distM(lat[a], lon[a], lat[b], lon[b]);
      legs[i] = m / speed;
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

const isMass = r => MASS_GROUPS.has(r.group);

// Mismo servicio (ida y vuelta de una ruta, o sus dos sentidos)
const sameService = (a, b) => a.leaf === b.leaf;

/**
 * Planifica un viaje.
 * @param g      grafo de loadTripGraph()
 * @param from   {lat, lon}
 * @param to     {lat, lon}
 * @param opts   { includeOld, at }  at = { day, min } en Lima: solo lo que
 *               circula a esa hora (el Metropolitano tiene horarios)
 * @returns { walkOnly, meters, options: [{ legs, minutes, transfers, walkM, cost, old }] }
 *          cada tramo 'ride' trae alts: [{ route, from, to }]
 */
export function planTrip(g, from, to, { includeOld = false, at = null } = {}){
  const direct = distM(from.lat, from.lon, to.lat, to.lon);
  const out = { walkOnly: direct <= WALK_ONLY_M, meters: direct, options: [] };
  if (out.walkOnly) return out;

  const active = new Set(g.activeRoutes({ includeOld, at }));
  const isActive = i => active.has(g.routes[i]);

  const origins = g.nearestStops(from.lat, from.lon, DIRECT_ACCESS_MAX_M);
  const destsAll = new Map(g.nearestStops(to.lat, to.lon, DIRECT_ACCESS_MAX_M));
  // Para transbordos, solo los paraderos a la distancia de siempre
  const dests = new Map([...destsAll].filter(([, m]) => m <= ACCESS_MAX_M));
  if (!origins.length || !destsAll.size) return out;

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
        const walkB = destsAll.get(x);
        if (walkB != null){
          keep(`${rIdx}`, {
            transfers: 0, minutes: head + ride1 + walkMin(walkB), walkM: walkA + walkB,
            r1: rIdx, o, p, k, walkA, walkB
          });
        }

        // Un transbordo: en el mismo paradero o caminando a uno cercano
        // (solo si al inicio se camina lo de siempre)
        if (walkA > ACCESS_MAX_M) continue;
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

  // Orden: costo total. La caminata pesa el doble (cuadras a pie con apuro),
  // cada transbordo suma una molestia y cada subida una espera que baja si
  // pasan varias rutas que sirven igual: así un directo que te deja lejos, o
  // que depende de una sola ruta, no gana siempre a un transbordo cómodo.
  const cands = Array.from(best.values(), c => {
    const legs = legsOf(g, c);
    // Descuento por los tramos en Metro, Metropolitano o corredor
    let massSaving = 0, massMin = 0, rideMin = 0;
    for (const l of legs){
      if (l.type !== 'ride') continue;
      let m = 0;
      for (let k = l.from; k < l.to; k++) m += legMin(g, l.route, k);
      rideMin += m;
      if (!isMass(l.route)) continue;
      massMin += m;
      massSaving += m * (1 - MASS_RIDE_FACTOR);
    }
    return { ...c, legs, mass: massSaving > 0, massShare: rideMin ? massMin / rideMin : 0,
      base: c.minutes - massSaving + walkMin(c.walkM) * (WALK_WEIGHT - 1)
        + walkMin(c.walkT || 0) * TRANSFER_WALK_EXTRA + c.transfers * TRANSFER_PENALTY };
  });
  cands.sort((a, b) => a.base - b.base);

  // Un transbordo no tiene sentido si una de sus rutas ya te lleva directo
  // (salvo que ahorre bastante): mejor quedarse en el mismo bus
  const svc = r => r.leaf;
  const directBase = new Map();
  for (const c of cands){
    if (c.transfers) continue;
    const k = svc(g.routes[c.r1]);
    if (!directBase.has(k)) directBase.set(k, c.base);
  }
  const useful = cands.filter(c => {
    if (!c.transfers) return true;
    // Un tramo de 1 o 2 paraderos no compensa el transbordo: mejor caminar
    if (c.legs.some(l => l.type === 'ride' && l.to - l.from < MIN_LEG_STOPS)) return false;
    return [g.routes[c.r1], g.routes[c.r2]].every(r => {
      const d = directBase.get(svc(r));
      return d == null || c.base < d - DOMINATED_SAVING_MIN;
    });
  });
  // Los mejores candidatos y, aunque los transbordos llenen esa lista, los mejores directos
  const top = useful.slice(0, TOP_FOR_ALTS);
  top.push(...useful.slice(TOP_FOR_ALTS).filter(c => !c.transfers).slice(0, 5));
  top.push(...useful.slice(TOP_FOR_ALTS).filter(c => c.mass && c.transfers).slice(0, 5));
  for (const c of top){
    let wait = 0;
    const mains = c.legs.filter(l => l.type === 'ride').map(l => l.route.leaf);
    for (const leg of c.legs){
      if (leg.type !== 'ride') continue;
      // Sin repetir en un tramo la ruta de otro tramo ("1057 › 1057"), y en
      // un transbordo sin las que ya van directo (esas son su propia opción)
      leg.alts = alternativesFor(g, leg, isActive).filter(a =>
        !mains.includes(a.route.leaf) && !(c.transfers && directBase.has(svc(a.route))));
      wait += (isMass(leg.route) ? MASS_WAIT_MIN : WAIT_MIN) / (1 + leg.alts.length);
    }
    c.cost = c.base + wait;
  }
  // Un directo va antes que cualquier transbordo, salvo que el transbordo
  // ahorre bastante: 20 min o el 20 % del viaje (en 2 h y media, 20 min no
  // compensan bajarse y esperar otro bus). Se compara con el directo cómodo
  // (poca caminata) más rápido o, si no hay, con el directo más rápido.
  const directs = top.filter(c => !c.transfers);
  const easy = directs.filter(c => c.walkM <= EASY_DIRECT_WALK_M);
  const bestDirectMin = Math.min(...(easy.length ? easy : directs).map(c => c.minutes));
  const mustSave = Math.max(TRANSFER_MUST_SAVE_MIN, TRANSFER_MUST_SAVE_SHARE * bestDirectMin);
  // Primero: directos cómodos y transbordos que sí ahorran; luego el resto por costo
  const tier = c => c.transfers
    ? (c.minutes <= bestDirectMin - mustSave ? 0 : 1)
    : (c.walkM <= EASY_DIRECT_WALK_M ? 0 : 1);
  top.sort((a, b) => tier(a) - tier(b) || a.cost - b.cost);

  // Una opción ya cubierta por otra (sus rutas son alternativas de aquella) no se repite
  const rideLegs = o => o.legs.filter(l => l.type === 'ride');
  const legSet = leg => new Set([leg.route, ...leg.alts.map(x => x.route)].map(svc));
  // Equivalentes: en cada tramo comparten alguna ruta (principal o alternativa)
  const covers = (o, c) => {
    const a = rideLegs(o), b = rideLegs(c);
    return a.length === b.length && b.every((l, i) => {
      const sa = legSet(a[i]);
      return [...legSet(l)].some(x => sa.has(x));
    });
  };
  // Variedad: como mucho 2 opciones que empiecen con las mismas rutas
  const sameStart = (o, c) => {
    const sa = legSet(rideLegs(o)[0]);
    return [...legSet(rideLegs(c)[0])].some(x => sa.has(x));
  };
  const picked = [];
  for (const c of top){
    if (picked.some(o => covers(o, c))) continue;
    if (c.transfers && picked.filter(o => o.transfers && sameStart(o, c)).length >= MAX_SAME_START) continue;
    picked.push(c);
    if (picked.length >= MAX_OPTIONS) break;
  }
  // Las rutas únicas razonables (directas) siempre aparecen: hay quien prefiere no cambiar de bus
  if (picked.length){
    const limit = picked[0].cost * DIRECT_MAX_RATIO;
    for (const d of top.filter(c => !c.transfers && c.cost <= limit)){
      if (picked.includes(d) || picked.some(o => covers(o, d))) continue;
      const drop = picked.map((o, i) => [o, i]).reverse().find(([o]) => o.transfers);
      if (picked.length >= MAX_OPTIONS){ if (!drop) break; picked.splice(drop[1], 1); }
      picked.push(d);
    }
    picked.sort((a, b) => tier(a) - tier(b) || a.cost - b.cost);
  }
  // Si se puede ir en Metro, Metropolitano o corredor, siempre aparece una opción así
  if (picked.length && !picked.some(c => c.mass)){
    // …y que haga buena parte del viaje en ellos (no 2 estaciones y luego un bus)
    const m = top.find(c => c.mass && c.massShare >= MASS_MIN_SHARE && c.cost <= picked[0].cost * MASS_MAX_RATIO && !picked.some(o => covers(o, c))
      && !(c.transfers && picked.filter(o => o.transfers && sameStart(o, c)).length >= MAX_SAME_START));
    // Le hace lugar el transbordo más caro (nunca una ruta única)
    const drop = picked.map((o, i) => [o, i]).filter(([o]) => o.transfers).sort((a, b) => b[0].cost - a[0].cost)[0];
    if (m && (picked.length < MAX_OPTIONS || drop)){
      if (picked.length >= MAX_OPTIONS) picked.splice(drop[1], 1);
      picked.push(m);
      picked.sort((a, b) => tier(a) - tier(b) || a.cost - b.cost);
    }
  }
  for (const c of picked){
    out.options.push({
      legs: c.legs,
      transfers: c.transfers,
      minutes: Math.round(c.minutes),
      walkM: Math.round(c.walkM),
      cost: Math.round(c.cost),
      mass: c.mass,
      old: rideLegs(c).some(l => l.route.group === 'antigua')
    });
  }
  return out;
}

// Otras rutas que hacen el mismo tramo: suben a 150 m o menos de donde sube
// la ruta del tramo y bajan a 150 m o menos de donde baja, sin tardar mucho más.
// Con varias, basta tomar la primera que pase.
function alternativesFor(g, leg, isActive){
  const r = leg.route;
  const s = r.stops[leg.from];
  const t = r.stops[leg.to];
  const boards = [[s, 0], ...g.walkFrom(s).filter(([, d]) => d <= ALT_M)];
  const alights = new Set([t, ...g.walkFrom(t).filter(([, d]) => d <= ALT_M).map(([j]) => j)]);
  let mainMin = 0;
  for (let k = leg.from; k < leg.to; k++) mainMin += legMin(g, r, k);
  const limit = mainMin * 1.4 + 5;

  const found = new Map();   // casilla → alternativa (una por servicio)
  for (const [b] of boards){
    for (const [ri, pos] of g.atStop[b]){
      if (!isActive(ri)) continue;
      const ar = g.routes[ri];
      if (sameService(ar, r) || found.has(ar.leaf)) continue;
      let m = 0;
      for (let k = pos + 1; k < ar.stops.length; k++){
        m += legMin(g, ar, k - 1);
        if (m > limit) break;
        if (alights.has(ar.stops[k])){ found.set(ar.leaf, { route: ar, from: pos, to: k, min: m }); break; }
      }
    }
  }
  // Las más rápidas primero
  return Array.from(found.values()).sort((a, b) => a.min - b.min).slice(0, MAX_ALTS);
}

// ¿Aparecerían más opciones con las rutas antiguas? (para ofrecerlas)
export function oldWouldHelp(g, from, to, { at = null } = {}){
  const withOld = planTrip(g, from, to, { includeOld: true, at });
  return withOld.options.some(o => o.old);
}

// Servicios con horario que servirían para este viaje pero no circulan a esa
// hora (p. ej. un expreso de hora punta): [route, ...], uno por servicio
export function offHoursHelp(g, from, to, { includeOld = false, at = null } = {}){
  if (!at) return [];
  const anyTime = planTrip(g, from, to, { includeOld });
  const found = new Map();
  anyTime.options.forEach(o => o.legs.forEach(l => {
    const r = l.route;
    if (l.type === 'ride' && r.schedule && !runsAt(r.schedule, at) && !found.has(r.leaf)) found.set(r.leaf, r);
  }));
  return Array.from(found.values());
}
