// tests/mobile.spec.js
// Celular: en la nueva interfaz el sidebar es una hoja inferior
// (mobileSheet.js); en la actual, nada se sale de la pantalla.
import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const sheetTop = (page) => page.$eval('#sidebar', s => s.getBoundingClientRect().top);
const sheetState = (page) => page.$eval('#sidebar', s => s.dataset.sheet);

test('interfaz actual: el sidebar y el buscador caben en la pantalla', async ({ app, page }) => {
  test.skip(await app.isBeta(), 'solo en la interfaz actual');
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sidebar: document.getElementById('sidebar').getBoundingClientRect().right,
    topbar: document.getElementById('topbar').getBoundingClientRect().right
  }));
  expect(r.sw).toBeLessThanOrEqual(390);
  expect(r.sidebar).toBeLessThanOrEqual(390);
  expect(r.topbar).toBeLessThanOrEqual(390);
});

test.describe('nueva interfaz en celular', () => {
  test.beforeEach(async ({ app }) => {
    test.skip(!(await app.isBeta()), 'solo con ?beta=1');
  });

  test('abre como hoja inferior a media altura, sin tapar ⚙', async ({ app, page }) => {
    await expect(page.locator('html')).toHaveClass(/sheet/);
    expect(await sheetState(page)).toBe('half');
    const box = await page.locator('#sidebar').boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(844);
    await expect(page.locator('#sidebar .header')).toBeHidden();
    const gear = await page.locator('#btnMapSettings').boundingBox();
    expect(gear.y + gear.height).toBeLessThan(box.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('la manija alterna asomada y media; las flechas llegan a completa', async ({ app, page }) => {
    await page.tap('#sheetHandle');
    await expect.poll(() => sheetState(page)).toBe('peek');
    // Asomada: se ven pestañas y buscador
    await expect(page.locator('#searchInput')).toBeInViewport();
    await page.tap('#sheetHandle');
    await expect.poll(() => sheetState(page)).toBe('half');
    await page.focus('#sheetHandle');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => sheetState(page)).toBe('full');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => sheetState(page)).toBe('half');
  });

  test('arrastrar la manija hacia arriba la abre completa', async ({ app, page }) => {
    const h = await page.locator('#sheetHandle').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, 120, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => sheetState(page)).toBe('full');
  });

  test('buscar abre la hoja; elegir una ruta la baja y la ruta queda a la vista', async ({ app, page }) => {
    await page.tap('#searchInput');
    await expect.poll(() => sheetState(page)).toBe('full');
    await app.search('1240');
    await page.keyboard.press('Enter');
    await expect.poll(() => sheetState(page)).toBe('peek');
    await app.settle();
    await page.waitForTimeout(600);

    const top = await sheetTop(page);
    const b = await app.state(s => {
      const bb = s.systems.wr.bounds.get('1240-ida');
      const ne = s.map.latLngToContainerPoint(bb.getNorthEast());
      const sw = s.map.latLngToContainerPoint(bb.getSouthWest());
      return { top: ne.y, bottom: sw.y, left: sw.x, right: ne.x };
    });
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.bottom).toBeLessThanOrEqual(top);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(390);
    // "En el mapa" entra en la hoja asomada
    await expect(page.locator('#onMap')).toBeInViewport({ ratio: 1 });
  });

  test('paradero: queda visible sobre el panel de rutas y la hoja', async ({ app, page }) => {
    const items = await app.search('puente nuevo');
    await items.first().click();
    await expect.poll(() => sheetState(page)).toBe('peek');
    await expect(page.locator('.route-inspector')).toBeVisible();
    await page.waitForTimeout(400);

    const ri = await page.locator('.route-inspector').boundingBox();
    expect(ri.y + ri.height).toBeLessThanOrEqual(await sheetTop(page));
    const pt = await app.state(s => {
      let p = null;
      s.map.eachLayer(l => { if (l.options?.fillColor === '#f59e0b') p = s.map.latLngToContainerPoint(l.getLatLng()); });
      return p;
    });
    expect(pt.y).toBeGreaterThan(0);
    expect(pt.y).toBeLessThan(ri.y);
  });

  test('tocar el mapa baja la hoja', async ({ app, page }) => {
    expect(await sheetState(page)).toBe('half');
    await page.mouse.click(120, 200);
    await expect.poll(() => sheetState(page)).toBe('peek');
  });
});
