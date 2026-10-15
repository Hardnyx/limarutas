import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripGraph } from '../assets/js/tripGraph.js';
import { createServiceCatalog } from '../assets/js/serviceCatalog.js';
import { planTrip } from '../assets/js/tripPlanner.js';
import { buildTimeline } from '../assets/js/tripTimeline.js';

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

function mixedFixture(){
  const catalog = createServiceCatalog({
    systems: { metro: { services: [{ id: 'L1' }, { id: 'L2' }] }, wr: { routes: [{ id: '1000' }] } },
    catalog: { transporte: { only: ['1000'] }, semiformal: { only: [] }, aerodirecto: { only: [] }, otros: { expreso_san_isidro: { only: [] } } }
  });
  return buildTripGraph({ districts: ['Lima'], stops: Array.from({ length: 7 }, (_, i) => [-12 - .01 * i, -77, `Paradero ${i}`, 0]),
    routes: { 'metro:L1:0': [0, 1, 2, 3], 'metro:L2:0': [3, 4, 5, 6], '1000-ida': [0, 1, 2, 3, 4, 5, 6] },
    segM: { '1000-ida': [6000, 6000, 6000, 6000, 6000, 6000] } }, catalog);
}

test('transport filters exclude other modes from rides and equivalent alternatives', () => {
  const g = mixedFixture();
  for (const mode of ['bus', 'metro']){
    const result = planTrip(g, { lat: -12, lon: -77 }, { lat: -12.06, lon: -77 }, { modes: [mode] });
    assert.ok(result.options.length);
    for (const option of result.options){
      for (const leg of option.legs.filter(l => l.type === 'ride')){
        for (const route of [leg.route, ...leg.alts.map(a => a.route)]) assert.equal(route.group === 'metro', mode === 'metro');
      }
    }
  }
});

test('fewer transfers changes the recommendation instead of relabelling the same ranking', () => {
  const g = mixedFixture(), from = { lat: -12, lon: -77 }, to = { lat: -12.06, lon: -77 };
  const normal = planTrip(g, from, to), fewer = planTrip(g, from, to, { sort: 'transfers' });
  assert.ok(normal.options[0].transfers > 0);
  assert.equal(fewer.options[0].transfers, 0);
  assert.match(fewer.options[0].recommendationReason, /menos transbordos/);
  const preferred = planTrip(g, from, to, { preferredModes: ['bus'] });
  assert.ok(preferred.options[0].legs.some(l => l.type === 'ride' && l.route.group !== 'metro'));
});

test('timeline totals reconcile with every computed itinerary without changing ranking or duration', () => {
  const g = mixedFixture();
  for (const at of [null, { day: 3, min: 1175 }, { day: 3, min: 1435 }]){
    const result = planTrip(g, { lat: -12, lon: -77 }, { lat: -12.06, lon: -77 }, { at });
    for (const option of result.options){
      const timeline = buildTimeline(option, at?.min ?? 630);
      assert.ok(Math.abs(timeline.calculatedMinutes - option.minutes) <= .5);
      assert.equal(timeline.rows.at(-1).offset, option.minutes);
      for (const leg of option.legs.filter(leg => leg.type === 'ride')){
        assert.equal(leg.segmentMinutes.length, leg.to - leg.from);
        assert.ok(leg.travelMinutes > 0);
      }
    }
  }
});
