// tests/beta.spec.js
// Nueva interfaz (?beta=1): pestañas, buscador en el sidebar, "En el mapa",
// orden de secciones, filtro de listas largas y ajustes del mapa.
import { test, expect } from './fixtures.js';

test.describe('nueva interfaz', () => {
  test.beforeEach(async ({ app }) => {
    test.skip(!(await app.isBeta()), 'solo con ?beta=1');
  });

  test('pestañas: se abre en Rutas y "Cómo llegar" anuncia lo que viene', async ({ app, page }) => {
    await expect(page.locator('#topbar')).toHaveCount(0);
    await expect(page.locator('#tabRoutes')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#routesPane #searchInput')).toBeVisible();

    await page.click('#tabTrip');
    await expect(page.locator('#tripPane')).toContainText('Próximamente');
    await expect(page.locator('#searchInput')).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tabRoutes')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#searchInput')).toBeVisible();
  });

  test('secciones en orden, con cantidad de rutas y subtítulos', async ({ app, page }) => {
    const titles = await page.$$eval('#panels > section.panel:not(#p-recent) > .panel-head .title',
      ts => ts.map(t => t.firstChild.textContent.trim()));
    expect(titles).toEqual(['Metro', 'Metropolitano', 'Corredores', 'Transporte público', 'AeroDirecto', 'Otros', 'Rutas antiguas']);

    const count = (sel) => page.locator(`section.panel:has(> .panel-head ${sel}) > .panel-head .panel-count`);
    await expect(count('#chk-metro')).toHaveText('2');
    await expect(count('#chk-wr')).toHaveText('440');
    await expect(page.locator('.panel-head:has(#chk-wr) .panel-sub')).toHaveText('Buses con ruta autorizada por la ATU');
    await expect(page.locator('.panel-head:has(#chk-wr-semi) .panel-sub')).toContainText('podrían ya no circular');
    // Las opciones ya no están en el sidebar
    await expect(page.locator('#panels #chkStops')).toHaveCount(0);
  });

  test('"En el mapa" cuenta las rutas marcadas y Limpiar las quita', async ({ app, page }) => {
    await expect(page.locator('#onMap')).toBeHidden();
    await app.search('1240');
    await page.keyboard.press('Enter');
    await expect(page.locator('#onMapCount')).toHaveText('1');
    await expect(page.locator('.panel-head:has(#chk-wr) .panel-count')).toHaveText('1/440');

    // Casilla de grupo (sin eventos en las hojas) también se cuenta
    await page.evaluate(() => document.getElementById('chk-metro').click());
    await expect(page.locator('#onMapCount')).toHaveText('3');

    await page.click('#btnClearAll');
    await expect(page.locator('#onMap')).toBeHidden();
    await app.settle();
    expect(await app.visibleWr()).toEqual([]);
  });

  test('filtro de lista: por empresa, sin desmarcar las ocultas; el grupo solo marca las visibles', async ({ app, page }) => {
    await app.search('1255');
    await page.keyboard.press('Enter');
    await expect(app.leaf('wr', '1255')).toBeChecked();

    await page.click('.panel-head:has(#chk-wr) .title');
    const filter = page.locator('#p-wr-body .list-filter');
    await filter.fill('vipusa');
    const shown = page.locator('#p-wr .item:not(.is-text-filtered)');
    await expect(shown.filter({ hasText: '1240' })).toHaveCount(1);
    const n = await shown.count();
    expect(n).toBeLessThan(10);
    // 1255 queda oculta pero sigue marcada y dibujada
    await expect(app.leaf('wr', '1255')).toBeChecked();

    // Con el filtro, el grupo marca solo lo visible
    await page.locator('#chk-wr').check();
    await expect(app.leaf('wr', '1240')).toBeChecked();
    await expect(page.locator('#onMapCount')).toHaveText(String(n + 1));
    await app.settle();
    const visible = await app.visibleWr();
    expect(visible).toHaveLength(n + 1);
    expect(visible).toEqual(expect.arrayContaining(['1240-ida', '1255-ida']));

    await filter.fill('zzzz');
    await expect(page.locator('#p-wr-body .list-filter-empty')).toBeVisible();
    await filter.press('Escape');
    await expect(filter).toHaveValue('');
    await expect(page.locator('#p-wr .item.is-text-filtered')).toHaveCount(0);
  });

  test('ajustes del mapa: se abren con ⚙ y se cierran con Esc o clic fuera', async ({ app, page }) => {
    await expect(page.locator('#mapSettings')).toBeHidden();
    await page.click('#btnMapSettings');
    await expect(page.locator('#mapSettings')).toBeVisible();
    await expect(page.locator('#btnMapSettings')).toHaveAttribute('aria-expanded', 'true');

    await page.locator('#chkStops').uncheck();
    expect(await app.state(s => s.showStops)).toBe(false);
    await expect(page.locator('#mapSettings')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#mapSettings')).toBeHidden();

    await page.click('#btnMapSettings');
    await page.mouse.click(900, 450);
    await expect(page.locator('#mapSettings')).toBeHidden();
  });

  test('la depuración de color solo aparece con ?debug=1', async ({ app, page }) => {
    await page.click('.panel-head:has(#chk-wr) .title');
    await expect(page.locator('#wrColorFilter')).toBeVisible();
    await page.goto('/index.html');   // beta queda recordada, sin debug
    await expect(page.locator('#status')).toHaveText('Listo', { timeout: 90_000 });
    await expect(page.locator('#tabRoutes')).toBeVisible();
    await page.click('.panel-head:has(#chk-wr) .title');
    await expect(page.locator('#wrColorFilter')).toBeHidden();
  });

  test('?beta=0 vuelve a la interfaz actual', async ({ app, page }) => {
    await page.goto('/index.html?beta=0');
    await expect(page.locator('#status')).toHaveText('Listo', { timeout: 90_000 });
    await expect(page.locator('#topbar #searchInput')).toBeVisible();
    await expect(page.locator('#tabRoutes')).toHaveCount(0);
    await expect(page.locator('#panels #chkStops')).toHaveCount(1);
  });
});

test('sin ?beta=1 no cambia la interfaz', async ({ app, page }) => {
  test.skip(await app.isBeta(), 'solo en la interfaz actual');
  await expect(page.locator('#topbar #searchInput')).toBeVisible();
  await expect(page.locator('#tabRoutes, #btnMapSettings, .list-filter')).toHaveCount(0);
  await expect(page.locator('#btnClearAll')).toHaveText('Desmarcar todo');
});
