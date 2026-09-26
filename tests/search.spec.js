// tests/search.spec.js
// Buscador: rutas por código, alias y paradero (incluidos nombres repetidos).
import { test, expect } from './fixtures.js';

test('buscar un código marca la ruta', async ({ app, page }) => {
  const items = await app.search('1240');
  await expect(items.first()).toContainText('1240');
  await page.keyboard.press('Enter');
  await expect(app.leaf('wr', '1240')).toBeChecked();
  await app.settle();
  expect(await app.visibleWr()).toEqual(['1240-ida']);
});

test('encuentra rutas por alias y empresa', async ({ app }) => {
  const items = await app.search('tablada');
  await expect(items.filter({ hasText: '1001' }).first()).toBeVisible();
});

test('las rutas semiformales se marcan en su propio panel', async ({ app, page }) => {
  const id = await page.$eval('#p-wr-semi .item .item-head input', c => c.dataset.id);
  await app.search(id);
  await page.keyboard.press('Enter');
  await expect(app.leaf('wrSemi', id)).toBeChecked();
});

test('no ofrece rutas que no están en ninguna lista', async ({ app, page }) => {
  await page.fill('#searchInput', '453');
  await page.waitForTimeout(600);
  const labels = await page.locator('.suggest-item .s-label').allTextContents();
  expect(labels.some(l => /^453\b/.test(l))).toBe(false);
});

test('Limpiar búsqueda vacía el campo y las sugerencias', async ({ app, page }) => {
  await app.search('1240');
  await page.click('#btnClearSearch');
  await expect(page.locator('#searchInput')).toHaveValue('');
  await expect(page.locator('.suggest-item')).toHaveCount(0);
});

test('paradero con nombre único: primero el paradero y debajo sus rutas', async ({ app, page }) => {
  const items = await app.search('puente nuevo');
  await expect(items.first()).toContainText('Puente Nuevo');
  await expect(items.first().locator('.s-sub')).toHaveText(/^Paradero · El Agustino · \d+ rutas$/);
  await expect(items.nth(1).locator('.s-sub')).toHaveText('Para en Puente Nuevo');

  await items.first().click();
  await expect(page.locator('.ri-title')).toHaveText('Paradero Puente Nuevo · El Agustino');
  const chips = await page.locator('.ri-chip').count();
  expect(chips).toBeGreaterThan(50);

  // "Mostrar las N rutas" pregunta por los paraderos (más de 30 rutas)
  await page.locator('.ri-hint .btn').click();
  await page.locator('.ui-dialog-btn', { hasText: 'Mostrar sin paraderos' }).click();
  await app.settle();
  expect((await app.visibleWr()).length).toBe(chips);
  await expect(page.locator('#chkStops')).not.toBeChecked();
});

test('nombre repetido: lista cada lugar con su distrito', async ({ app, page }) => {
  await app.search('separadora industrial');
  const stops = page.locator('.suggest-item:has(.s-ico-stop)');
  expect(await stops.count()).toBeGreaterThanOrEqual(5);
  const subs = await stops.locator('.s-sub').allTextContents();
  const districts = new Set(subs.map(s => s.split(' · ')[1]));
  expect(districts.size).toBeGreaterThanOrEqual(3);
  expect(districts).toContain('Villa El Salvador');
  // Varios en un mismo distrito se distinguen por el paradero vecino
  expect(subs.some(s => s.includes('cerca de'))).toBe(true);
});

test('elegir una ruta ya marcada lleva el mapa a ella y la sube en recientes', async ({ app, page }) => {
  await app.search('1240');
  await page.keyboard.press('Enter');
  await app.search('1255');
  await page.keyboard.press('Enter');
  await app.settle();
  await app.setView(-12.3, -76.8, 15);
  const before = await app.view();

  await app.search('1240');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  expect(await app.view()).not.toEqual(before);
  const inView = await app.state(s => s.map.getBounds().intersects(s.systems.wr.bounds.get('1240-ida')));
  expect(inView).toBe(true);
  await expect(page.locator('#p-recent-list .recent-item').first()).toContainText('1240');
});
