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
  const codes = await page.locator('.suggest-item .s-ico').allTextContents();
  expect(codes.some(c => /^453$/.test(c.trim()))).toBe(false);
});

test('se busca por el alias que conoce la gente: "la 36" y "36" traen primero la 1199', async ({ app, page }) => {
  for (const q of ['la 36', '36']){
    const items = await app.search(q);
    await expect(items.first(), q).toContainText('1199');
    await expect(items.first(), q).toContainText('La 36');
  }
});

test('la marca conocida manda: "evifasa b" trae la 1194 y "evifasa" sus dos rutas', async ({ app, page }) => {
  const items = await app.search('evifasa b');
  await expect(items.first()).toContainText('1194');
  await expect(items.first()).toContainText('EVIFASA B');
  const all = await app.search('evifasa');
  await expect(all.filter({ hasText: '1469' }).first()).toBeVisible();
  await expect(all.filter({ hasText: '1194' }).first()).toBeVisible();
});

test('Limpiar búsqueda vacía el campo y las sugerencias', async ({ app, page }) => {
  await app.search('1240');
  await page.click('#btnClearSearch');
  await expect(page.locator('#searchInput')).toHaveValue('');
  await expect(page.locator('.suggest-item')).toHaveCount(0);
});

test('paradero con nombre único: primero el grupo Paraderos; al elegirlo, sus rutas', async ({ app, page }) => {
  const items = await app.search('puente nuevo');
  await expect(page.locator('.suggest-head').first()).toHaveText('Paraderos');
  await expect(items.first()).toContainText('Puente Nuevo');
  await expect(items.first().locator('.s-sub')).toHaveText(/^Paradero · El Agustino · \d+ rutas$/);

  await items.first().click();
  await expect(page.locator('.ri-title')).toHaveText('Paradero Puente Nuevo · El Agustino');
  const chips = await page.locator('.ri-chip').count();
  expect(chips).toBeGreaterThan(50);

  // "Mostrar las N rutas" pregunta por los paraderos (más de 30 rutas)
  await page.locator('.ri-show-all').click();
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
  // Varios en un mismo distrito se distinguen por su cruce o el paradero vecino
  const labels = await stops.locator('.s-label').allTextContents();
  const shown = labels.map((l, k) => `${l} | ${subs[k]}`);
  expect(new Set(shown).size).toBe(shown.length);
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
  // Sube en recientes (en la nueva interfaz, está en "En el mapa")
  const list = (await app.isBeta()) ? '#onMapList' : '#p-recent-list';
  await expect(page.locator(`${list} .recent-item`, { hasText: '1240' })).toHaveCount(1);
  if (!(await app.isBeta())) await expect(page.locator('#p-recent-list .recent-item').first()).toContainText('1240');
});

test('paraderos del mismo nombre se distinguen por su cruce; buscar el cruce trae ese', async ({ app, page }) => {
  // "Universitaria" está en decenas de cruces: cada uno con el suyo
  const items = await app.search('universitaria');
  const labels = await items.locator('.s-label').allTextContents();
  expect(labels.filter(l => /^Universitaria con /.test(l)).length).toBeGreaterThanOrEqual(5);
  // Nombre y cruce: los paraderos de ese cruce primero (se llamen como una u otra calle)
  const one = await app.search('universitaria naranjal');
  await expect(one.first().locator('.s-label')).toHaveText(/^(Universitaria con Naranjal|Naranjal con Universitaria)$/);
});

test('resultados en grupos: un código va primero a Rutas, un lugar a Paraderos', async ({ app, page }) => {
  await app.search('1240');
  await expect(page.locator('.suggest-head').first()).toHaveText('Rutas');
  await app.search('universitaria');
  await expect(page.locator('.suggest-head').first()).toHaveText('Paraderos');
  await expect(page.locator('.suggest-head')).toHaveText(['Paraderos', 'Rutas']);
});

test('con las flechas, la lista baja con el elegido y salta los títulos', async ({ app, page }) => {
  await app.search('universitaria');
  const box = page.locator('#searchSuggest');
  for (let k = 0; k < 14; k++) await page.keyboard.press('ArrowDown');
  const sel = page.locator('#searchSuggest .suggest-item.selected');
  await expect(sel).toHaveCount(1);
  const [b, r] = await Promise.all([box.boundingBox(), sel.boundingBox()]);
  expect(r.y).toBeGreaterThanOrEqual(b.y - 1);
  expect(r.y + r.height).toBeLessThanOrEqual(b.y + b.height + 1);
  expect(await box.evaluate(n => n.scrollTop)).toBeGreaterThan(0);
});

test('el cruce se encuentra por cualquiera de sus calles y se muestra empezando por la buscada', async ({ app, page }) => {
  const items = await app.search('javier prado brasil');
  await expect(items.first().locator('.s-label')).toHaveText('Javier Prado con Brasil');
  // Los dos paraderos del cruce (Brasil y Javier Prado) son un solo resultado
  const labels = await items.locator('.s-label').allTextContents();
  expect(labels.filter(l => /Javier Prado con Brasil|Brasil con Javier Prado/.test(l)).length).toBe(1);
  const other = await app.search('brasil javier prado');
  await expect(other.first().locator('.s-label')).toHaveText('Brasil con Javier Prado');
});

test('nombres con que se conoce: tréboles, bypasses, Colonial, Wilson y el 22', async ({ app, page }) => {
  // El nombre propio del cruce
  const tre = await app.search('trebol de javier prado');
  await expect(tre.first().locator('.s-label')).toHaveText(/^Trébol /);
  await expect(tre.first().locator('.s-sub')).toContainText('Trébol de Javier Prado');
  // Paso a desnivel
  const byp = await app.search('bypass javier prado');
  await expect(byp.first().locator('.s-label')).toHaveText(/^Bypass .*Javier Prado|^Bypass Javier Prado/);
  // Colonial, no "Colonial con Óscar R. Benavides" (es la misma avenida); se
  // encuentra también por su nombre oficial
  const col = await app.search('colonial');
  const labels = await col.locator('.s-label').allTextContents();
  expect(labels.some(l => /Benavides/.test(l) && /Colonial/.test(l))).toBe(false);
  const ofi = await app.search('oscar benavides');
  await expect(ofi.filter({ hasText: 'Colonial' }).first()).toBeVisible();
  // Wilson y Colmena, como se las conoce en el Centro
  const wil = await app.search('wilson colmena');
  await expect(wil.first().locator('.s-label')).toHaveText(/Wilson con Colmena|Colmena con Wilson/);
  // "22": el Kilómetro 22 de Túpac Amaru
  await app.search('22');
  await expect(page.locator('.suggest-item', { hasText: 'Kilómetro 22' }).first()).toBeVisible();
});
