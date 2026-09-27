// tests/sidebar.spec.js
// Casillas del sidebar: jerarquía de grupos, filtro de color, sentido y encuadre.
import { test, expect } from './fixtures.js';

test('arranca sin rutas marcadas ni dibujadas', async ({ app, page }) => {
  await expect(page.locator('#panels .item .item-head input:checked')).toHaveCount(0);
  const groups = await page.$$eval('#panels .panel-head > input', cs => cs.filter(c => c.checked || c.indeterminate || c.disabled).length);
  expect(groups).toBe(0);
  expect(await app.visibleWr()).toEqual([]);
});

test('cada casilla de grupo marca y desmarca todas sus rutas', async ({ app, page }) => {
  // Sin paraderos no hay advertencia de muchas rutas (se prueba en map.spec.js)
  await (await app.setting('#chkStops')).uncheck();
  const groups = await page.$$eval('#panels .panel-head > input', cs => cs.map(c => c.id));
  // Metro, Metropolitano (y sus subgrupos), corredores activos, WR…
  expect(groups.length).toBeGreaterThan(15);

  for (const id of groups){
    const res = await page.evaluate((gid) => {
      const g = document.getElementById(gid);
      const leaves = () => [...g.closest('.panel').querySelectorAll('.item .item-head input')];
      g.click();
      const on = { group: g.checked && !g.indeterminate, total: leaves().length, checked: leaves().filter(c => c.checked).length };
      g.click();
      const off = { group: g.checked || g.indeterminate, checked: leaves().filter(c => c.checked).length };
      return { on, off };
    }, id);
    expect(res.on.total, `${id} tiene rutas`).toBeGreaterThan(0);
    expect(res.on.checked, `${id} marca todas`).toBe(res.on.total);
    expect(res.on.group, `${id} queda marcado`).toBe(true);
    expect(res.off.checked, `${id} desmarca todas`).toBe(0);
    expect(res.off.group, `${id} queda desmarcado`).toBe(false);
  }
});

test('Metropolitano incluye Alimentadores y queda a medias con una sola ruta', async ({ app, page }) => {
  await page.locator('#chk-met').check();
  const alim = page.locator('#p-met-alim .item .item-head input');
  await expect(alim.first()).toBeChecked();
  expect(await alim.evaluateAll(cs => cs.every(c => c.checked))).toBe(true);
  await expect(page.locator('#chk-met-alim')).toBeChecked();

  await page.click('#btnClearAll');
  await page.evaluate(() => document.querySelector('#p-met-alim-n .item input').click());
  expect(await page.$eval('#chk-met', c => c.indeterminate)).toBe(true);
  expect(await page.$eval('#chk-met-alim-n', c => c.indeterminate)).toBe(true);
});

test('Desmarcar todo quita todas las rutas del mapa', async ({ app, page }) => {
  await page.evaluate(() => { document.getElementById('chk-metro').click(); document.getElementById('chk-wr-aero').click(); });
  await app.settle();
  expect((await app.visibleWr()).length).toBe(3);
  await page.click('#btnClearAll');
  await app.settle();
  await expect(page.locator('#panels .item .item-head input:checked')).toHaveCount(0);
  expect(await app.visibleWr()).toEqual([]);
  const metro = await app.state(s => { let n = 0; s.systems.metro.lineLayers.forEach(g => { n += g.getLayers().length; }); return n; });
  expect(metro).toBe(0);
});

test('la casilla de grupo encuadra todas sus rutas', async ({ app, page }) => {
  await app.setView(-12.2, -76.9, 15);
  await page.evaluate(() => document.getElementById('chk-wr-aero').click());
  await app.settle();
  const inside = await app.state(s => {
    const view = s.map.getBounds();
    const ids = ['AD-C-ida', 'AD-N-ida', 'AD-S-ida'];
    return ids.every(id => view.contains(s.systems.wr.bounds.get(id)));
  });
  expect(inside).toBe(true);
});

test('filtro de color: separa rutas y el grupo solo marca las visibles', async ({ app, page }) => {
  await page.click('.panel-head[data-target="p-wr-body"]');
  const btn = mode => page.locator(`#wrColorFilter .segbtn-mini[data-mode="${mode}"]`);
  await expect(btn('all')).toContainText(/\(\d+\)/);

  await btn('real').click();
  const visibles = await page.locator('#p-wr .item:not(.is-color-filtered)').count();
  const total = await page.locator('#p-wr .item').count();
  expect(visibles).toBeGreaterThan(0);
  expect(visibles).toBeLessThan(total);

  await page.locator('#chk-wr').click();
  await page.locator('.ui-dialog-btn', { hasText: 'Mostrar sin paraderos' }).click();
  await expect(page.locator('#p-wr .item.is-color-filtered .item-head input:checked')).toHaveCount(0);
  await expect(page.locator('#p-wr .item:not(.is-color-filtered) .item-head input:checked')).toHaveCount(visibles);

  // Al ocultar rutas marcadas se desmarcan
  await btn('default').click();
  await expect(page.locator('#p-wr .item.is-color-filtered .item-head input:checked')).toHaveCount(0);
  await btn('all').click();
});

test('cambiar de sentido muestra el otro y no mueve la vista', async ({ app, page }) => {
  await page.click('.panel-head[data-target="p-wr-body"]');
  await app.leaf('wr', '1240').check();
  await app.settle();
  expect(await app.visibleWr()).toEqual(['1240-ida']);

  await app.setView(-12.0, -77.05, 14);
  const before = await app.view();
  await page.evaluate(() => document.querySelector('#p-wr input[data-id="1240"]')
    .closest('.item').querySelector('.segbtn-mini[data-dir="vuelta"]').click());
  await app.settle();
  expect(await app.visibleWr()).toEqual(['1240-vuelta']);
  expect(await app.view()).toEqual(before);
});

test('marcar y desmarcar enseguida no deja la ruta dibujada', async ({ app, page }) => {
  await page.evaluate(() => {
    const c = document.querySelectorAll('#p-wr .item .item-head input')[50];
    c.click(); c.click();
  });
  await page.waitForTimeout(4000);
  expect(await app.visibleWr()).toEqual([]);
});

test('elegir sentido en una ruta sin marcar la muestra (en todos los sistemas)', async ({ app, page }) => {
  // Wikiroutes
  await page.evaluate(() => document.querySelector('#p-wr input[data-id="1240"]')
    .closest('.item').querySelector('.segbtn-mini[data-dir="vuelta"]').click());
  await app.settle();
  await expect(app.leaf('wr', '1240')).toBeChecked();
  expect(await app.visibleWr()).toEqual(['1240-vuelta']);
  // Metropolitano
  const id = await page.$eval('#p-met-exp .item .item-head input', c => c.dataset.id);
  await page.evaluate(() => document.querySelector('#p-met-exp .item .segbtn-mini:not(.active)').click());
  await expect(app.leaf('met', id)).toBeChecked();
});

test('tema del mapa: el botón activo queda marcado', async ({ app, page }) => {
  await expect(page.locator('#btnLight')).toHaveClass(/active/);
  await (await app.setting('#btnDark')).click();
  await expect(page.locator('#btnDark')).toHaveClass(/active/);
  await expect(page.locator('#btnLight')).not.toHaveClass(/active/);
});

test('no hay un segundo control de dirección para Metropolitano', async ({ app, page }) => {
  await expect(page.locator('input[name="dir"]')).toHaveCount(0);
});

test('colores de ruta chillones se suavizan y llevan texto oscuro', async ({ app, page }) => {
  // 1122 viene en amarillo fosforescente (#FEFF00) desde Wikiroutes
  const tag = page.locator('#p-wr .item:has(input[data-id="1122"]) .item-head .tag');
  const bg = await tag.evaluate(t => getComputedStyle(t).backgroundColor);
  expect(bg).not.toBe('rgb(254, 255, 0)');
  await expect(tag).toHaveClass(/on-light/);
  const line = await app.state(s => s.systems.wr.routeDefs.get('1122-ida')?.color);
  expect(line?.toLowerCase()).not.toBe('#feff00');
});

test('Metropolitano: cada servicio muestra su recorrido y horario; los de un solo sentido no tienen N/S', async ({ app, page }) => {
  // Cada línea: recorrido y, debajo (.met-hours), el horario
  const item = (id) => page.locator(`#p-met .item:has(> .item-head input[data-id="${id}"])`);
  // Expreso 6: solo de Izaguirre a Benavides, en la mañana
  await expect(item('6').locator('.met-trip')).toHaveText(['Izaguirre → BenavidesL–V 5:30–10:00']);
  await expect(item('6').locator('.segbtn-mini')).toHaveCount(0);
  // Expreso 8: horario distinto por sentido
  await expect(item('8').locator('.met-trip')).toHaveText([
    'Izaguirre → Plaza de FloresL–V 17:00–20:20',
    'Plaza de Flores → IzaguirreL–V 17:00–21:00'
  ]);
  await expect(item('8').locator('.segbtn-mini')).toHaveCount(3);
  // Regular C: ida y vuelta con el mismo horario, en una línea
  await expect(item('C').locator('.met-trip')).toHaveText(['Ramón Castilla ↔ MatelliniL–S 5:00–23:00 · Dom 5:00–22:00']);
  // Expreso 1: horarios distintos por sentido y los fines de semana
  await expect(item('1').locator('.met-trip')).toHaveText([
    'Estación Central → MatelliniL–V 5:30–21:00 · Sáb y Dom 6:30–21:00',
    'Matellini → Estación CentralL–V 5:00–21:00 · Sáb y Dom 6:00–21:00'
  ]);
  // SXN desde 22 de Agosto: solo al sur, con el ícono del SXN
  await expect(item('SXN-22').locator('.name')).toHaveText('Súper Expreso Norte desde 22 de Agosto');
  await expect(item('SXN-22').locator('img.badge')).toHaveAttribute('src', /\/SXN\.png$/);
  await expect(item('SXN-22').locator('.segbtn-mini')).toHaveCount(0);
  // La Ruta D ya no opera
  await expect(app.leaf('met', 'D')).toHaveCount(0);

  // Un expreso de un solo sentido se dibuja solo en ese sentido
  await page.evaluate(() => document.querySelector('#p-met .item-head input[data-id="6"]').click());
  await expect.poll(() => app.state(s => s.systems.met.lineLayers.get('6')?.getLayers().length)).toBe(1);
});
