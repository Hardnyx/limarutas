import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripGraph } from '../assets/js/tripGraph.js';
import { createServiceCatalog } from '../assets/js/serviceCatalog.js';
import { planTrip } from '../assets/js/tripPlanner.js';

function fixture(){
  const catalog = createServiceCatalog({ systems: { metro: { services: [{ id: 'L1', color: '#008000' }] } } });
  return buildTripGraph({ districts: ['Lima'], stops: [
    [-12, -77, 'Inicio', 0], [-12.01, -77, 'Medio', 0], [-12.02, -77, 'Fin', 0],
    [-12.0002, -77, 'Auxiliar', 0]
  ], routes: { 'metro:L1:0': [0, 1, 2], 'metro:L1:1': [2, 1, 0], hidden: [0, 2] } }, catalog);
}

test('spatial lookup keeps separate platforms and excludes out-of-catalog routes', () => {
  const g = fixture();
  assert.equal(g.routes.length, 2);
  assert.equal(g.routes[0].serviceId, g.routes[1].serviceId);
  assert.deepEqual(g.nearestStops(-12, -77, 50).map(([i]) => i), [0, 3]);
  assert.deepEqual(g.walkFrom(0).map(([i]) => i), [3]);
  assert.deepEqual(g.atStop[1], [[0, 1], [1, 1]]);
  assert.ok(g.routes.every(r => !('leaf' in r)));
});

test('planning works without a document and preserves forward travel in both directions', () => {
  const g = fixture();
  for (const [a, b, key] of [[-12, -12.02, 'metro:L1:0'], [-12.02, -12, 'metro:L1:1']]){
    const result = planTrip(g, { lat: a, lon: -77 }, { lat: b, lon: -77 });
    assert.equal(result.walkOnly, false);
    assert.ok(result.options.length);
    const rides = result.options[0].legs.filter(l => l.type === 'ride');
    assert.equal(rides.length, 1);
    assert.equal(rides[0].route.key, key);
    assert.ok(rides[0].to > rides[0].from);
    assert.equal(rides[0].alts.length, 0);
  }
  assert.equal(planTrip(g, { lat: -12, lon: -77 }, { lat: -12.0001, lon: -77 }).walkOnly, true);
});
