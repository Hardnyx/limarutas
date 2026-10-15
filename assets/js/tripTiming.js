import { distM } from './geo.js';

// Planning defaults, not measured per-service speeds or live traffic.
// Station/stop delays remain separate from time in motion.
const BUS_M_PER_MIN = 1000 / 3;
const FAST_M_PER_MIN = 500;
const BRT_M_PER_MIN = 500;
const BUS_STOP_MIN = 0.5;
// All time boundaries used by the weekday/weekend traffic profiles.
const BOUNDARIES = [330, 360, 390, 570, 660, 750, 840, 1020, 1200, 1230, 1260, 1320, 1440];

export function congestionWeight(at){
  if (!at) return 0.5;
  const { day, min } = at;
  if (min < 330 || min >= 1320) return 0;
  if (day === 0) return 0.2;
  if (day === 6) return 0.4;
  return (min >= 360 && min < 570) || (min >= 1020 && min < 1260) ? 1 : 0.5;
}

export function busPeakFactor(at){
  if (!at) return 1.15;
  const { day, min } = at;
  if (day === 0) return 1;
  if (day === 6) return min >= 660 && min < 1200 ? 1.1 : 1;
  if (min >= 1020 && min < 1230) return 1.8;
  if (min >= 390 && min < 570) return 1.5;
  if (min >= 750 && min < 840) return 1.1;
  return 1;
}

export const stopDelayOf = route => route.group === 'metro' ? 0 : BUS_STOP_MIN;

function period(at, offset){
  if (!at) return { at: null, remaining: Infinity };
  const absolute = at.min + offset, days = Math.floor(absolute / 1440);
  const min = absolute - days * 1440;
  return { at: { day: (at.day + days) % 7, min }, remaining: BOUNDARIES.find(t => t > min) - min };
}

const cache = new WeakMap();
function profile(g, route, at){
  const road = route.group !== 'metro' && route.group !== 'metropolitano';
  const weight = road ? congestionWeight(at) : 0, peak = road ? busPeakFactor(at) : 1;
  const key = `${weight}:${peak}`;
  let variants = cache.get(route);
  if (!variants){ variants = new Map(); cache.set(route, variants); }
  if (variants.has(key)) return variants.get(key);
  const speed = route.group === 'metro' ? FAST_M_PER_MIN : route.group === 'metropolitano' ? BRT_M_PER_MIN : BUS_M_PER_MIN;
  const legs = new Float64Array(Math.max(0, route.stops.length - 1));
  const prefix = new Float64Array(legs.length + 1);
  for (let k = 0; k < legs.length; k++){
    const a = route.stops[k], b = route.stops[k + 1];
    const meters = route.segM?.[k] ?? distM(g.stops.lat[a], g.stops.lon[a], g.stops.lat[b], g.stops.lon[b]);
    const slow = road ? route.slow?.[k] || 0 : 0;
    const local = 1 + weight * slow / 100;
    // Both positive factors describe traffic relative to the same base.
    // Use the stronger estimate, rather than charging traffic twice.
    // Dedicated lanes keep their local advantage without the citywide penalty.
    const factor = !road ? 1 : slow < 0 ? 1 + slow / 100 : Math.max(peak, local);
    legs[k] = meters / speed * factor;
    prefix[k + 1] = prefix[k] + legs[k];
  }
  const result = { legs, prefix }; variants.set(key, result);
  return result;
}

export function estimateSegment(g, route, k, at, offset = 0){
  if (route.group === 'metro' || route.group === 'metropolitano'){
    return profile(g, route, null).legs[k] + stopDelayOf(route);
  }
  let fraction = 1, elapsed = 0;
  while (fraction > 1e-9){
    const current = period(at, offset + elapsed);
    const whole = profile(g, route, current.at).legs[k];
    const minutes = whole * fraction;
    if (minutes <= current.remaining){ elapsed += minutes; break; }
    // Continue the untravelled distance at the speed of the next period.
    fraction -= current.remaining / whole;
    elapsed += current.remaining;
  }
  return elapsed + stopDelayOf(route);
}

export function estimateRide(g, route, from, to, at, offset = 0){
  const current = period(at, offset), { prefix } = profile(g, route, current.at);
  const uniform = prefix[to] - prefix[from] + (to - from) * stopDelayOf(route);
  if (uniform <= current.remaining || route.group === 'metro' || route.group === 'metropolitano') return uniform;
  let elapsed = 0;
  for (let k = from; k < to; k++) elapsed += estimateSegment(g, route, k, at, offset + elapsed);
  return elapsed;
}
