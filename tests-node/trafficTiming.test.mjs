import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateSegment, estimateRide } from '../assets/js/tripTiming.js';

const g = { stops: { lat: [0, .01], lon: [0, 0] } };
const route = slow => ({ group: 'atu', stops: [0, 1], segM: [1000], slow: [slow] });

test('road and city traffic describe one delay rather than multiplying each other', () => {
  assert.ok(Math.abs(estimateSegment(g, route(40), 0, { day: 3, min: 1080 }) - 5.9) < 1e-9);
  assert.ok(Math.abs(estimateSegment(g, route(100), 0, { day: 3, min: 1080 }) - 6.5) < 1e-9);
});

test('a segment crossing the end of rush hour travels its remainder at the new speed', () => {
  const r = route(0), start = 1229;
  const early = estimateSegment(g, r, 0, { day: 3, min: start });
  const later = estimateSegment(g, r, 0, { day: 3, min: 1230 });
  assert.ok(Math.abs(early - (1 + (1 - 1 / 5.4) * 3 + .5)) < 1e-9);
  assert.equal(later, 3.5);
  assert.ok(start + early <= 1230 + later, 'leaving earlier must not arrive later at a speed transition');
});

test('exclusive lanes keep their advantage in rush hour and at night', () => {
  for (const min of [1080, 1380]) assert.ok(Math.abs(estimateSegment(g, route(-40), 0, { day: 3, min }) - 2.3) < 1e-9);
});

test('Metropolitano travel and stop delays stay independent of road traffic', () => {
  const r = { ...route(100), group: 'metropolitano' };
  for (const min of [630, 1080, 1380]) assert.equal(estimateRide(g, r, 0, 1, { day: 3, min }), 2.5);
});

test('the illustrated Los Chinos ride does not keep evening rush hour until midnight', () => {
  const raw = JSON.parse(readFileSync(new URL('../pipeline/output/trip_graph.json', import.meta.url), 'utf8'));
  const graph = { stops: { lat: raw.stops.map(s => s[0]), lon: raw.stops.map(s => s[1]) } };
  const r = { group: 'atu', stops: raw.routes['1185-ida'], segM: raw.segM['1185-ida'], slow: raw.slow['1185-ida'] };
  const from = r.stops.findIndex(i => raw.stops[i][2] === 'Control');
  const to = r.stops.findIndex((i, k) => k > from && raw.stops[i][2] === 'Separadora Industrial');
  const evening = estimateRide(graph, r, from, to, { day: 3, min: 1196 });
  const midday = estimateRide(graph, r, from, to, { day: 3, min: 630 });
  assert.ok(evening < 200, `evening ride: ${evening} min`);
  assert.ok(evening > midday, 'the correction must retain evening traffic');
});
