import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTripGraph } from '../assets/js/tripGraph.js';
import { createServiceCatalog } from '../assets/js/serviceCatalog.js';
import { planTrip } from '../assets/js/tripPlanner.js';
import { buildTimeline } from '../assets/js/tripTimeline.js';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const raw = read('pipeline/output/trip_graph.json');
const services = read('data/processed/metropolitano/metropolitano_services.json').services;
function metGraph(ids){
  return buildTripGraph(raw, createServiceCatalog({ systems: { met: { services: services.filter(s => ids.includes(s.id)) } } }));
}
const point = i => ({ lat: raw.stops[i][0], lon: raw.stops[i][1] });
const rides = option => option.legs.filter(l => l.type === 'ride');

test('Expreso 5 stays aboard until Plaza de Flores before changing to C', () => {
  const g = metGraph(['5', 'C']);
  const result = planTrip(g, point(raw.routes['met:5:ns'][3]), point(raw.routes['met:C:ns'].at(-1)), { at: { day: 3, min: 630 } });
  const legs = rides(result.options[0]);
  assert.deepEqual(legs.map(l => l.route.code), ['5', 'C']);
  assert.equal(g.stops.name[legs[0].route.stops[legs[0].to]], 'Plaza de Flores');
  assert.equal(g.stops.name[legs[1].route.stops[legs[1].from]], 'Plaza de Flores');
  assert.ok(Math.abs(buildTimeline(result.options[0], 630).calculatedMinutes - result.options[0].minutes) <= .5);
});

test('Chimpu Ocllo to Central distinguishes the three-stop express from the twenty-stop B', () => {
  const from = point(raw.routes['met:B:ns'][0]), to = point(raw.routes['met:B:ns'].at(-1));
  // These services operate in different weekday time windows; compare their
  // onboard times, not the availability of one simultaneous departure.
  const express = rides(planTrip(metGraph(['13']), from, to, { at: { day: 3, min: 420 } }).options[0])[0];
  const regular = rides(planTrip(metGraph(['B']), from, to, { at: { day: 3, min: 630 } }).options[0])[0];
  assert.equal(express.to - express.from, 3);
  assert.equal(regular.to - regular.from, 20);
  assert.ok(regular.travelMinutes > express.travelMinutes + 8);
  assert.ok(Math.abs(regular.travelMinutes - express.travelMinutes - (regular.stopMinutes - express.stopMinutes)) < .001);
});

test('road buses, corridors and feeders pay for served stops even at identical distances', () => {
  for (const group of ['atu', 'corredor', 'alimentador', 'antigua']){
    const make = dense => {
      const stops = Array.from({ length: 7 }, (_, i) => [-12 - .02 * i, -77, `Stop ${i}`, 0]);
      const seq = dense ? [0, 1, 2, 3, 4, 5, 6] : [0, 3, 6];
      const catalog = { routeFor: () => ({ serviceId: 'bus:1', code: '1', group, verified: true }) };
      const graph = buildTripGraph({ districts: ['Lima'], stops, routes: { bus: seq }, segM: { bus: seq.slice(1).map(() => 12000 / (seq.length - 1)) } }, catalog);
      return rides(planTrip(graph, { lat: -12, lon: -77 }, { lat: -12.12, lon: -77 }).options[0])[0];
    };
    const sparse = make(false), dense = make(true);
    assert.equal(dense.to - dense.from, 6);
    assert.ok(Math.abs(dense.travelMinutes - sparse.travelMinutes - 2) < .001, group);
    assert.equal(dense.stopMinutes, 3);
  }
});
