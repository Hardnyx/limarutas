import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceCatalog } from '../assets/js/serviceCatalog.js';

test('directional layers share identity and corridor classification wins overlap', () => {
  const route = { id: '301', pair: { ida: '301-ida', vuelta: '301-vuelta' }, color: '#123456' };
  const catalog = createServiceCatalog({
    systems: { wr: { routes: [route] }, met: { services: [{ id: 'A', schedule: { ns: [[1, 360, 600]] } }] } },
    corridors: [route], catalog: { transporte: { only: ['301'] }, semiformal: { only: [] }, aerodirecto: { only: [] }, otros: { expreso_san_isidro: { only: [] } } }
  });
  assert.equal(catalog.routeFor('301-ida').serviceId, 'corr:301');
  assert.equal(catalog.routeFor('301-vuelta').serviceId, 'corr:301');
  assert.equal(catalog.routeFor('301-ida').corridorName, 'Corredor Azul');
  assert.equal(catalog.routeFor('301-vuelta').color, '#003594');
  assert.deepEqual(catalog.routeFor('met:A:ns').schedule, [[1, 360, 600]]);
  assert.equal(catalog.routeFor('met:D:ns'), null);
});

test('exclusions and verified old aliases apply without rendered controls', () => {
  const catalog = createServiceCatalog({ systems: { wr: { routes: [{ id: '0123' }, { id: '456_789' }] } },
    catalog: { transporte: { only: [], exclude: [] }, aerodirecto: { only: [] }, otros: { expreso_san_isidro: { only: [] } },
      semiformal: { only: ['123', '456'], exclude: ['456'], verificadas: ['123'] } } });
  assert.equal(catalog.routeFor('0123-ida').verified, true);
  assert.equal(catalog.routeFor('456_789-ida'), null);
});
