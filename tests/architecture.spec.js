import { test, expect } from './fixtures.js';

test('route metadata agrees with the visible catalog in both interfaces', async ({ app, page }) => {
  const result = await page.evaluate(async () => {
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const { loadServiceCatalog } = await import('/assets/js/catalogRepository.js');
    const catalog = await loadServiceCatalog();
    const { wrChipName } = await import('/assets/js/wrTexts.js');
    const graph = await loadTripGraph();
    return graph.routes.map(route => {
      const leaf = route.leaf || document.querySelector(
        `#panels .item .item-head input[data-system="${route.system}"][data-id="${CSS.escape(route.id)}"]`);
      const item = leaf?.closest('.item');
      const code = item?.querySelector('.item-head .left .tag, .item-head .left .badge')?.textContent?.trim();
      const service = catalog.routeFor(route.key);
      return {
        catalog: !!service && service.system === leaf?.dataset.system && service.id === leaf?.dataset.id && service.code === route.code && service.alias === route.alias && service.verified === route.verified,
        key: route.key,
        found: !!leaf,
        code: route.code === (code || leaf?.dataset.id || route.key),
        alias: route.alias === wrChipName(item?.__wrMeta),
        id: !route.serviceId || route.serviceId === `${leaf?.dataset.system}:${leaf?.dataset.id}`
      };
    });
  });
  expect(result.length).toBeGreaterThan(1000);
  expect(result.filter(r => !r.catalog || !r.found || !r.code || !r.alias || !r.id)).toEqual([]);
});

test('rebuilding the graph does not depend on the mounted sidebar', async ({ app, page }) => {
  const equal = await page.evaluate(async () => {
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const before = (await loadTripGraph()).routes.map(r => r.key);
    document.querySelector('#panels').remove();
    const after = (await loadTripGraph({ force: true })).routes;
    return JSON.stringify(before) === JSON.stringify(after.map(r => r.key)) && after.every(r => !('leaf' in r));
  });
  expect(equal).toBe(true);
});

test('commands, checkboxes and clear-all agree on selected services', async ({ app, page }) => {
  await page.evaluate(async () => {
    const { setRouteSelected } = await import('/assets/js/routeControls.js');
    setRouteSelected('met', 'A', true, { fit: false });
  });
  await expect(app.leaf('met', 'A')).toBeChecked();
  await app.leaf('met', 'A').evaluate(c => c.click());
  expect(await page.evaluate(async () => {
    const { routeSelection } = await import('/assets/js/selectionState.js');
    return routeSelection.get('met', 'A').selected;
  })).toBe(false);
  await app.leaf('metro', 'L1').evaluate(c => c.click());
  await page.locator('#btnClearAll').click();
  expect(await page.evaluate(async () => {
    const { routeSelection } = await import('/assets/js/selectionState.js');
    return routeSelection.selected();
  })).toEqual([]);
});
