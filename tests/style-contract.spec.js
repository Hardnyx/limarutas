import { test, expect } from './fixtures.js';

test('shared components retain their styles across themes and screen sizes', async ({ app, page }) => {
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  if (await page.locator('#tabTrip').count()){
    await page.click('#tabTrip');
    await page.evaluate(async () => {
      const { setTripEnds } = await import('/assets/js/tripUi.js');
      const { loadTripGraph } = await import('/assets/js/tripData.js');
      const graph = await loadTripGraph();
      // CSS snapshots need a stable chip color, independent of planner ranking.
      const active = graph.activeRoutes.bind(graph);
      graph.activeRoutes = opts => active(opts).filter(route => route.serviceId === 'met:B');
      const route = graph.routes.find(r => r.key === 'met:B:ns');
      const from = [...route.stops].find(i => graph.stops.name[i] === 'Naranjal');
      const to = route.stops.at(-1);
      const point = i => ({ lat: graph.stops.lat[i], lon: graph.stops.lon[i], label: graph.stops.name[i] });
      await setTripEnds(point(from), point(to));
    });
  }
  const snapshots = [];
  for (const width of [1280, 390]){
    await page.setViewportSize({ width, height: 844 });
    for (const dark of [false, true]){
      snapshots.push(await page.evaluate(([width, dark]) => {
        document.documentElement.classList.toggle('theme-dark', dark);
        const selectors = ['#sidebar', '.btn', '.tag', '.panel-head', '.suggest', '.side-tab',
          '.trip-field', '.trip-input', '.trip-card', '.trip-time', '.trip-steps', '.trip-chip'];
        const properties = ['display', 'color', 'background-color', 'font-size', 'font-weight',
          'border-radius', 'border-top-color', 'padding', 'margin', 'box-shadow', 'flex-direction'];
        const styles = Object.fromEntries(selectors.map(selector => {
          const node = document.querySelector(selector);
          if (!node) return [selector, null];
          const style = getComputedStyle(node);
          return [selector, Object.fromEntries(properties.map(p => [p, style.getPropertyValue(p)]))];
        }));
        return { width, dark, styles };
      }, [width, dark]));
    }
  }
  expect(JSON.stringify(snapshots, null, 2)).toMatchSnapshot('components.json');
});
