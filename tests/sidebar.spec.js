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

  // Horario oficial de salida del terminal (portal de la ATU)
  const as07 = page.locator('#p-met-alim .item:has(input[data-id="AS-07"]) .met-hours');
  await expect(as07).toHaveText('Sale L-S 05:30-00:00 · D 05:30-23:00');

  // Los que OSM no tiene salen de los mapas QR (config/alim_trazados.json)
  const sjd = page.locator('#p-met-alim .item:has(input[data-id="AN-20"]) .met-trip');
  await expect(sjd).toHaveText('Circuito: Chimpu Ocllo → San Juan de Dios → Chimpu Ocllo');
  await expect(page.locator('#p-met-alim .item:has(input[data-id="AN-03"]) .met-hours'))
    .toHaveText('Sale L-V 06:00-08:30 y 17:00-00:00');
  await expect(page.locator('#p-met-alim .item:has(input[data-id="AN-22"]) .met-hours')).toHaveText('Trazado aproximado');
});

test('Alimentadores: por defecto solo la ida, con sus paraderos; los paraderos siguen al sentido dibujado', async ({ app, page }) => {
  const drawn = id => app.state((state, id) => {
    const sys = state.systems.alim;
    const lines = sys.lineLayers.get(id)?.getLayers().length || 0;
    const marks = sys.stopLayers.get(id)?.getLayers() || [];
    const stops = marks.map(m => m.getTooltip()?.getContent());
    // Puntitos como los del corredor; solo la estación de partida, con ícono
    const pins = marks.filter(m => !(m instanceof L.CircleMarker)).map(m => m.getTooltip()?.getContent());
    const p = sys.paths[id];
    return { lines, stops, pins, ida: p.ida.stops.map(s => s.name), vuelta: p.vuelta.stops.map(s => s.name) };
  }, id);
  const item = page.locator('#p-met-alim .item:has(input[data-id="AN-03"])');
  await expect(item.locator('.segbtn-mini.active')).toHaveText('Ida');
  const click = sel => page.evaluate(sel => document.querySelector(sel).click(), sel);
  const btn = dir => `#p-met-alim .item:has(input[data-id="AN-03"]) .segbtn-mini[data-dir="${dir}"]`;
  await click('#p-met-alim .item input[data-id="AN-03"]');
  let r = await drawn('AN-03');
  expect(r.lines).toBe(1);
  // Los de la ida, sin repetir la estación (la ida y la vuelta la comparten)
  expect(r.stops).toEqual(r.ida);
  expect(r.pins).toEqual(['Universidad']);

  await click(btn('norte'));
  r = await drawn('AN-03');
  expect(r.lines).toBe(1);
  expect(r.stops).toEqual(r.vuelta);

  await click(btn('ambas'));
  r = await drawn('AN-03');
  expect(r.lines).toBe(2);
  // Los dos sentidos; la estación, una vez
  expect(r.stops.length).toBe(r.ida.length + r.vuelta.length - 1);

  // Sin "Mostrar paradas", ninguno
  await (await app.setting('#chkStops')).uncheck();
  r = await drawn('AN-03');
  expect(r.stops).toEqual([]);
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

test('rutas del PRR sin color heredan el de su código antiguo; las inactivas según Wikipedia lo avisan', async ({ app, page }) => {
  await page.click('.panel-head[data-target="p-wr-body"]');
  const item = id => page.locator(`#p-wr .item:has(> .item-head input[data-id="${id}"])`);
  // 1320 (antigua 1104): verde de Wikipedia, ya no el azul metálico
  await expect(item('1320')).toHaveAttribute('data-color-kind', 'real');
  // 1369 (antigua 4602) figura inactiva en Wikipedia
  await expect(item('1369').locator('.wr-flag')).toHaveText('Según Wikipedia ya no circula');
  await expect(item('1320').locator('.wr-flag')).toBeHidden();
  // 1285 (antigua IM24): alias histórico «la 129» del artículo de Wikipedia
  await expect(item('1285').locator('.wr-main-title')).toContainText('La 129');
  // Primero el nombre con el que la conoce la gente: la marca y la letra
  // (EVIFASA B), el número (La 36) o la empresa con la letra (Santa Luzmila C)
  await expect(item('1194').locator('.wr-main-title')).toHaveText('EVIFASA B · Virgen de Fátima');
  await expect(item('1199').locator('.wr-main-title')).toHaveText('La 36 · 36 San Martín de Porres');
  await expect(item('1020').locator('.wr-main-title')).toHaveText('Santa Luzmila C');
});

test.describe('fotos referenciales', () => {
  test.use({ routePhotos: { rutas: { '1320': [{
    imagen: 'https://upload.wikimedia.org/prueba/480px-Bus.jpg',
    pagina: 'https://commons.wikimedia.org/wiki/File:Bus.jpg',
    autor: 'Autora de prueba', licencia: 'CC BY-SA 4.0',
    licencia_url: 'https://creativecommons.org/licenses/by-sa/4.0', fuente: 'Wikimedia Commons'
  }] } } });

  test('la ruta con foto muestra el botón; la foto lleva autor, licencia y fuente', async ({ app, page }) => {
    await page.click('.panel-head[data-target="p-wr-body"]');
    const item = id => page.locator(`#p-wr .item:has(> .item-head input[data-id="${id}"])`);
    const btn = item('1320').locator('.wr-photo-btn');
    await expect(btn).toHaveText('Foto');
    // Sin foto no hay botón
    await expect(item('1122').locator('.wr-photo-btn')).toHaveCount(0);

    await expect(item('1320').locator('.wr-photos')).toBeHidden();
    await btn.click();
    const photo = item('1320').locator('.wr-photo');
    await expect(photo).toBeVisible();
    await expect(photo.locator('img')).toHaveAttribute('src', 'https://upload.wikimedia.org/prueba/480px-Bus.jpg');
    await expect(photo.locator('figcaption')).toHaveText('Foto referencial: Autora de prueba · CC BY-SA 4.0 · Wikimedia Commons');
    await expect(photo.locator('figcaption a', { hasText: 'CC BY-SA 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});

test('paraderos formales: sólidos del color de la ruta; al tocarlos, sus alimentadores y corredores', async ({ app, page }) => {
  await app.search('AN-19');
  await page.keyboard.press('Enter');
  await app.settle();
  // Puntos sólidos (relleno del color de la ruta, borde blanco)
  const style = await app.state(s => {
    let out = null;
    s.systems.alim.stopLayers.get('AN-19')?.eachLayer(l => {
      if (!out && l instanceof L.CircleMarker) out = { fill: l.options.fillColor, color: l.options.color };
    });
    return out;
  });
  expect(style.color).toBe('#fff');
  expect(style.fill).not.toBe('#fff');
  // Tocar un paradero abre el panel con los alimentadores que paran ahí
  await app.state(s => {
    let m = null;
    s.systems.alim.stopLayers.get('AN-19')?.eachLayer(l => { if (!m && l instanceof L.CircleMarker) m = l; });
    m.fire('click');
  });
  await expect(page.locator('.route-inspector')).toBeVisible();
  await expect(page.locator('.ri-title')).toHaveText(/^Paradero /);
  await expect(page.locator('.ri-chip', { hasText: 'AN-19' })).toHaveCount(1);
});

test('recorrido paso a paso: el del sentido elegido, por las calles de OSM', async ({ app, page }) => {
  await page.click('.panel-head[data-target="p-wr-body"]');
  const item = page.locator('#p-wr .item:has(> .item-head input[data-id="1087"])');
  const btn = item.locator('.route-steps-btn');
  await expect(btn).toHaveText('Recorrido');
  const box = item.locator('.route-steps-box');
  await expect(box).toBeHidden();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const steps = box.locator('.route-step');
  await expect(steps.first()).toContainText(/^Por /);
  expect(await steps.count()).toBeGreaterThan(5);
  await expect(steps.first().locator('.route-step-m')).toHaveText(/^\d+(,\d)? (m|km)$/);
  await expect(box.locator('.route-steps-note')).toHaveText('Calles de OpenStreetMap');
  // Otro sentido: sus pasos (el primero de la ida no es el de la vuelta)
  const ida = await steps.allTextContents();
  await item.locator('.segbtn-mini[data-dir="vuelta"]').click();
  await expect.poll(async () => (await steps.allTextContents()).join('|')).not.toBe(ida.join('|'));
  await expect(steps.first()).toContainText(/^Por /);
  // Cerrar
  await btn.click();
  await expect(box).toBeHidden();
});

test('alimentadores: recorrido del sentido elegido; con los dos, ida y vuelta por separado', async ({ app, page }) => {
  const sel = '#p-met-alim .item:has(input[data-id="AN-19"])';
  const item = page.locator(sel);
  await page.evaluate(sel => document.querySelector(`${sel} .route-steps-btn`).click(), sel);
  const box = item.locator('.route-steps-box');
  await expect(box.locator('.route-step').first()).toHaveText(/^Por Avenida Túpac Amaru/);
  await expect(box.locator('.route-steps-title')).toHaveCount(0);
  await page.evaluate(sel => document.querySelector(`${sel} .segbtn-mini[data-dir="ambas"]`).click(), sel);
  await expect(box.locator('.route-steps-title')).toHaveText(['Ida · hacia Izaguirre', 'Vuelta · hacia Naranjal']);
});
