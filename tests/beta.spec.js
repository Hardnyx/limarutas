// tests/beta.spec.js
// Nueva interfaz (la de todos; ?beta=0 vuelve a la anterior): pestañas, buscador en el sidebar, "En el mapa",
// orden de secciones, filtro de listas largas y ajustes del mapa.
import { test, expect } from './fixtures.js';

test.describe('nueva interfaz', () => {
  test.beforeEach(async ({ app }) => {
    test.skip(!(await app.isBeta()), 'solo en la nueva interfaz');
  });

  test('secciones en orden, con cantidad de rutas y subtítulos', async ({ app, page }) => {
    const titles = await page.$$eval('#panels > section.panel:not(#p-recent) > .panel-head .title',
      ts => ts.map(t => t.firstChild.textContent.trim()));
    expect(titles).toEqual(['Metro', 'Metropolitano', 'Corredores', 'Transporte público', 'AeroDirecto', 'Otros', 'Rutas antiguas']);

    const count = (sel) => page.locator(`section.panel:has(> .panel-head ${sel}) > .panel-head .panel-count`);
    await expect(count('#chk-metro')).toHaveText('2');
    await expect(count('#chk-wr')).toHaveText('421');
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
    await expect(page.locator('.panel-head:has(#chk-wr) .panel-count')).toHaveText('1/421');

    // Casilla de grupo (sin eventos en las hojas) también se cuenta
    await page.evaluate(() => document.getElementById('chk-metro').click());
    await expect(page.locator('#onMapCount')).toHaveText('3');

    await page.click('#btnClearAll');
    await expect(page.locator('#onMap')).toBeHidden();
    await app.settle();
    expect(await app.visibleWr()).toEqual([]);
  });

  test('"En el mapa" desglosa las rutas marcadas: ir a una, quitarla, un grupo entero en una fila', async ({ app, page }) => {
    await app.search('1240');
    await page.keyboard.press('Enter');
    await app.search('1255');
    await page.keyboard.press('Enter');
    const rows = page.locator('#onMapList .recent-item');
    await expect(rows).toHaveCount(2);
    // Recientes no las repite: están en el mapa
    await expect(page.locator('#p-recent')).toBeHidden();
    // Se pliega y despliega
    await page.click('#onMapToggle');
    await expect(page.locator('#onMapList')).toBeHidden();
    await page.click('#onMapToggle');
    await expect(rows).toHaveCount(2);
    // Tocar la fila lleva el mapa a la ruta
    await app.settle();
    await app.setView(-12.3, -76.8, 15);
    await rows.filter({ hasText: '1240' }).locator('.on-map-go').click();
    await expect.poll(() => app.state(s => s.map.getBounds().intersects(s.systems.wr.bounds.get('1240-ida')))).toBe(true);
    // × la quita del mapa y pasa al historial
    await rows.filter({ hasText: '1255' }).locator('.recent-remove').click();
    await expect(app.leaf('wr', '1255')).not.toBeChecked();
    await expect(page.locator('#p-recent-list .recent-item', { hasText: '1255' })).toHaveCount(1);
    // Todo el Metropolitano: una sola fila
    await page.evaluate(() => document.getElementById('chk-met').click());
    await expect(page.locator('#onMapList .is-group')).toHaveCount(1);
    await expect(page.locator('#onMapList .is-group')).toContainText('Metropolitano');
    await page.locator('#onMapList .is-group .recent-remove').click();
    await expect(page.locator('#onMapList .is-group')).toHaveCount(0);
    await expect(rows).toHaveCount(1);
  });

  test('lista larga abierta: su título queda arriba al bajar y al cerrarla vuelve a él', async ({ page }) => {
    await page.click('.panel-head:has(#chk-wr) .title');
    const head = page.locator('#panels > section.panel:has(> .panel-head #chk-wr) > .panel-head');
    await page.locator('#panels').evaluate(n => { n.scrollTop = 4000; });
    await page.waitForTimeout(200);
    const [p, h] = await Promise.all([page.locator('#panels').boundingBox(), head.boundingBox()]);
    expect(Math.abs(h.y - p.y)).toBeLessThan(3);
    await head.locator('.title').click();
    await expect(page.locator('#p-wr-body')).toBeHidden();
    const h2 = await head.boundingBox();
    expect(h2.y).toBeGreaterThanOrEqual(p.y - 1);
  });

  test('filtro de lista: por empresa, sin desmarcar las ocultas; el grupo solo marca las visibles', async ({ app, page }) => {
    await app.search('1255');
    await page.keyboard.press('Enter');
    await expect(app.leaf('wr', '1255')).toBeChecked();

    await page.click('.panel-head:has(#chk-wr) .title');
    const filter = page.locator('#p-wr-body .list-filter');
    await filter.fill('vipusa');
    const shown = page.locator('#p-wr .item:not(.is-text-filtered)');
    // El filtro se aplica tras una breve espera
    await expect.poll(() => shown.count()).toBeLessThan(10);
    await expect(shown.filter({ hasText: '1240' })).toHaveCount(1);
    const n = await shown.count();
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
    await page.goto('/index.html');   // sin debug
    await expect(page.locator('#status')).toHaveText('Listo', { timeout: 90_000 });
    await page.click('#tabRoutes');
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

test('con ?beta=0 se ve la interfaz anterior', async ({ app, page }) => {
  test.skip(await app.isBeta(), 'solo en la interfaz actual');
  await expect(page.locator('#topbar #searchInput')).toBeVisible();
  await expect(page.locator('#tabRoutes, #btnMapSettings, .list-filter')).toHaveCount(0);
  await expect(page.locator('#btnClearAll')).toHaveText('Desmarcar todo');
});

test.describe('pestaña con la que abre', () => {
  test.use({ startTab: 'default' });

  test('abre en Cómo llegar; ←/→ cambian a Rutas', async ({ app, page }) => {
    test.skip(!(await app.isBeta()), 'solo en la nueva interfaz');
    await expect(page.locator('#topbar')).toHaveCount(0);
    await expect(page.locator('#tabTrip')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tripFrom')).toBeVisible();
    await expect(page.locator('#searchInput')).toBeHidden();

    await page.focus('#tabTrip');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tabRoutes')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#routesPane #searchInput')).toBeVisible();
  });

  test('sin parámetros, la nueva interfaz es la predeterminada', async ({ app, page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#status')).toHaveText('Listo', { timeout: 90_000 });
    // En el proyecto de la interfaz anterior, ?beta=0 quedó recordado
    const remembered = await page.evaluate(() => localStorage.getItem('limarutas.interfazAnterior'));
    await expect(page.locator('#tabTrip')).toHaveCount(remembered === '1' ? 0 : 1);
  });
});
