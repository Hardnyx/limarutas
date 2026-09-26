// tests/map.spec.js
// Mapa: paraderos con nombre, panel "Rutas en este punto" y la advertencia
// de muchas rutas.
import { test, expect } from './fixtures.js';

// Zona con más rutas superpuestas (Av. 9 de Octubre)
const HOTSPOT = [-12.0425, -77.0225];

async function showAllPublicTransport(page, choice = 'Mostrar sin paraderos'){
  await page.evaluate(() => document.getElementById('chk-wr').click());
  await page.locator('.ui-dialog-btn', { hasText: choice }).click();
}

test('paraderos activos por defecto, con nombre y sin marcadores falsos', async ({ app, page }) => {
  await expect(page.locator('#chkStops')).toBeChecked();
  await app.search('1240');
  await page.keyboard.press('Enter');
  await app.settle();
  const stops = await app.state(s => {
    const out = [];
    s.systems.wr.stopLayers.get('1240-ida').eachLayer(l => l.eachLayer(m => out.push(m.feature.properties)));
    return out;
  });
  expect(stops.length).toBe(144);
  expect(stops[0]).toMatchObject({ name: 'Las Palmas', seq: 1 });
  expect(stops.every(p => p.name && p.stop_id)).toBe(true);
});

test('pasar el mouse por un paradero muestra su nombre', async ({ app, page }) => {
  await app.search('1240');
  await page.keyboard.press('Enter');
  await app.settle();
  const stop = await app.state(s => {
    const out = [];
    s.systems.wr.stopLayers.get('1240-ida').eachLayer(l => l.eachLayer(m => out.push(m)));
    const m = out[60];
    return { lat: m.getLatLng().lat, lng: m.getLatLng().lng, name: m.feature.properties.name };
  });
  await app.setView(stop.lat, stop.lng, 17);
  const pt = await app.screenPoint(stop.lat, stop.lng);
  await page.mouse.move(pt.x + 3, pt.y + 3);
  await page.mouse.move(pt.x, pt.y);
  await expect(page.locator('.leaflet-tooltip.stop-tip')).toHaveText(stop.name);
  // Una sola ruta: el panel de rutas superpuestas no aparece
  await page.waitForTimeout(400);
  await expect(page.locator('.route-inspector')).toBeHidden();
});

test('rutas superpuestas: chips, detalle con resaltado y clic para fijar', async ({ app, page }) => {
  await showAllPublicTransport(page);
  await app.settle();
  await app.setView(HOTSPOT[0], HOTSPOT[1], 16);
  const c = await app.screenPoint(...HOTSPOT);

  // Buscar el punto con más rutas cerca del centro
  let best = { n: 0 };
  for (let dx = -48; dx <= 48; dx += 12){
    for (let dy = -48; dy <= 48; dy += 12){
      await page.mouse.move(c.x + dx, c.y + dy);
      await page.waitForTimeout(220);
      const n = await page.locator('.route-inspector:not([hidden]) .ri-chip').count();
      if (n > best.n) best = { n, dx, dy };
    }
  }
  expect(best.n).toBeGreaterThanOrEqual(10);

  await page.mouse.move(c.x + best.dx, c.y + best.dy);
  await page.waitForTimeout(300);
  await page.mouse.click(c.x + best.dx, c.y + best.dy);
  await expect(page.locator('.route-inspector')).toHaveClass(/pinned/);

  await page.locator('.ri-chip').nth(2).hover();
  await expect(page.locator('.ri-detail .ri-detail-title')).not.toBeEmpty();
  const dimmed = await app.state(s => {
    let dim = 0;
    s.systems.wr.layers.forEach(g => {
      if (!s.map.hasLayer(g)) return;
      g.eachLayer(l => l.eachLayer?.(x => { if (x.options.opacity === 0.15) dim++; }));
    });
    return dim;
  });
  expect(dimmed).toBeGreaterThan(0);
});

test('advertencia de muchas rutas: grupo chico no pregunta', async ({ app, page }) => {
  await page.evaluate(() => document.getElementById('chk-wr-aero').click());
  await page.waitForTimeout(300);
  await expect(page.locator('.ui-dialog')).toHaveCount(0);
  await expect(page.locator('#chk-wr-aero')).toBeChecked();
});

test('advertencia de muchas rutas: cada botón hace lo que dice', async ({ app, page }) => {
  // Cancelar: no marca nada
  await page.evaluate(() => document.getElementById('chk-wr').click());
  await expect(page.locator('.ui-dialog')).toBeVisible();
  await expect(page.locator('#chk-wr')).not.toBeChecked();
  await page.locator('.ui-dialog-btn', { hasText: 'Cancelar' }).click();
  await expect(page.locator('#p-wr .item .item-head input:checked')).toHaveCount(0);

  // Esc también cancela
  await page.evaluate(() => document.getElementById('chk-wr').click());
  await page.keyboard.press('Escape');
  await expect(page.locator('.ui-dialog')).toHaveCount(0);
  await expect(page.locator('#chk-wr')).not.toBeChecked();

  // Mostrar con paraderos
  await showAllPublicTransport(page, 'Mostrar con paraderos');
  await expect(page.locator('#chk-wr')).toBeChecked();
  await expect(page.locator('#chkStops')).toBeChecked();

  // Mostrar sin paraderos
  await page.click('#btnClearAll');
  await showAllPublicTransport(page, 'Mostrar sin paraderos');
  await expect(page.locator('#chk-wr')).toBeChecked();
  await expect(page.locator('#chkStops')).not.toBeChecked();

  // Reactivar paradas con muchas rutas visibles también pregunta
  await app.settle();
  await page.locator('#chkStops').click();
  await expect(page.locator('.ui-dialog')).toBeVisible();
  await page.locator('.ui-dialog-btn', { hasText: 'Cancelar' }).click();
  await expect(page.locator('#chkStops')).not.toBeChecked();
});
