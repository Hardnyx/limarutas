import { test, expect } from './fixtures.js';

test('every Metropolitano direction follows its continuous A/B backbone', async ({ app, page }) => {
  const result = await page.evaluate(async () => {
    const { state } = await import('/assets/js/config.js');
    const { getMetMacroId, renderService, hideService } = await import('/assets/js/mapLayers.js');
    const errors = [], checked = [];
    state.dir = 'ambas';
    for (const svc of state.systems.met.services) {
      renderService('met', svc.id, { silentFit: true });
      const lines = state.systems.met.lineLayers.get(svc.id).getLayers();
      const directions = ['ns', 'sn'].filter(d => svc[d === 'ns' ? 'north_south' : 'south_north']?.length);
      if (lines.length !== directions.length) errors.push(`${svc.id}: missing direction`);
      directions.forEach((d, index) => {
        const path = state.systems.met.paths[`${svc.id}:${d}`];
        const macro = getMetMacroId(svc, d);
        const base = state.systems.met.macros[macro][d === 'ns' ? 'north_south' : 'south_north'][0];
        const [first, last] = path.backboneRange;
        const actual = lines[index]?.getLatLngs().map(p => [p.lat, p.lng]);
        if (path.macro !== macro || JSON.stringify(path.coords) !== JSON.stringify(base.slice(first, last + 1))) errors.push(`${svc.id}:${d}: shortcut`);
        if (JSON.stringify(actual) !== JSON.stringify(path.coords) || lines[index]?.options.smoothFactor !== 0) errors.push(`${svc.id}:${d}: rendering differs`);
        checked.push(`${svc.id}:${d}`);
      });
      hideService('met', svc.id);
    }
    const asymmetric = { north_south: ['tacna-sur', 'estacion-central'], south_north: ['canada', 'naranjal'] };
    return { errors, checked, branch: [getMetMacroId(asymmetric, 'ns'), getMetMacroId(asymmetric, 'sn')],
      defaultBranch: getMetMacroId({ north_south: ['naranjal', 'estacion-central'] }, 'ns') };
  });
  expect(result.errors).toEqual([]);
  expect(result.checked).toHaveLength(31);
  expect(result.branch).toEqual(['A', 'B']);
  expect(result.defaultBranch).toBe('B');
});

test('Metropolitano fallback uses the directed macro and station pins remain legible in both themes', async ({ app, page }, info) => {
  await page.evaluate(async () => {
    const { state } = await import('/assets/js/config.js');
    const { renderService } = await import('/assets/js/mapLayers.js');
    state.systems.met.paths = {};
    state.dir = 'ns';
    renderService('met', 'B', { silentFit: true });
    state.map.setView([-12.0465, -77.042], 16, { animate: false });
  });
  expect(await app.state(s => s.systems.met.lineLayers.get('B').getLayers()[0].getLatLngs().length)).toBeGreaterThan(500);
  const pin = page.locator('.stop-pin').first();
  const style = () => pin.evaluate(el => {
    const s = getComputedStyle(el); return { background: s.backgroundImage, border: s.borderColor, size: [s.width, s.height] };
  });
  const light = await style();
  expect(light.background).toContain('radial-gradient');
  expect(light.size).toEqual(['16px', '16px']);
  expect(light.border).toBe('rgb(187, 0, 0)');
  await page.screenshot({ path: `pipeline/temp/authoring/met-stops-light-${info.project.name}.png` });
  await (await app.setting('#btnDark')).click();
  expect(await style()).toEqual(light);
  await page.screenshot({ path: `pipeline/temp/authoring/met-stops-dark-${info.project.name}.png` });
});
