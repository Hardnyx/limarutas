import { test, expect } from './fixtures.js';

test('route metadata agrees with the visible catalog in both interfaces', async ({ app, page }) => {
  const result = await page.evaluate(async () => {
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const { wrChipName } = await import('/assets/js/wrTexts.js');
    const graph = await loadTripGraph();
    return graph.routes.map(route => {
      const leaf = route.leaf || document.querySelector(
        `#panels .item .item-head input[data-system="${route.system}"][data-id="${CSS.escape(route.id)}"]`);
      const item = leaf?.closest('.item');
      const code = item?.querySelector('.item-head .left .tag, .item-head .left .badge')?.textContent?.trim();
      return {
        key: route.key,
        found: !!leaf,
        code: route.code === (code || leaf?.dataset.id || route.key),
        alias: route.alias === wrChipName(item?.__wrMeta),
        id: !route.serviceId || route.serviceId === `${leaf?.dataset.system}:${leaf?.dataset.id}`
      };
    });
  });
  expect(result.length).toBeGreaterThan(1000);
  expect(result.filter(r => !r.found || !r.code || !r.alias || !r.id)).toEqual([]);
});
