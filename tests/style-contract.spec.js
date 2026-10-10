import { test, expect } from './fixtures.js';

test('shared components retain their styles across themes and screen sizes', async ({ app, page }) => {
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  if (await page.locator('#tabTrip').count()){
    await page.click('#tabTrip');
    await page.evaluate(async () => {
      const { setTripEnds } = await import('/assets/js/tripUi.js');
      await setTripEnds({ lat: -11.981, lon: -77.058, label: 'Naranjal' },
        { lat: -12.172, lon: -77.011, label: 'Matellini' });
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
