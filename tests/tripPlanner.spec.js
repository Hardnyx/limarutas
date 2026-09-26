// tests/tripPlanner.spec.js
// "Cómo llegar": cálculo de viajes (tripPlanner.js) y su pestaña en la nueva
// interfaz (tripUi.js).
import { test, expect } from './fixtures.js';

const PUENTE_NUEVO = { lat: -12.0433, lon: -77.0126 };
const PLAZA_SAN_MARTIN = { lat: -12.0515, lon: -77.0347 };
const VES = { lat: -12.2130, lon: -76.9370 };
const COMAS = { lat: -11.9380, lon: -77.0600 };

// Corre planTrip en la página y devuelve un resumen de cada opción
function plan(page, from, to, opts = {}){
  return page.evaluate(async ([a, b, o]) => {
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const { planTrip, ACCESS_MAX_M } = await import('/assets/js/tripPlanner.js');
    const g = await loadTripGraph();
    const t = performance.now();
    const res = planTrip(g, a, b, o);
    const ms = performance.now() - t;
    const { lat, lon } = g.stops;
    const d = (i, p) => Math.hypot((lon[i] - p.lon) * 108_900, (lat[i] - p.lat) * 110_574);
    return {
      ms,
      walkOnly: res.walkOnly,
      options: res.options.map(opt => {
        const rides = opt.legs.filter(l => l.type === 'ride');
        const first = rides[0], lastR = rides[rides.length - 1];
        return {
          transfers: opt.transfers,
          minutes: opt.minutes,
          old: opt.old,
          codes: rides.map(l => l.route.code),
          services: rides.map(l => `${l.route.leaf.dataset.system}:${l.route.leaf.dataset.id}`),
          forward: rides.every(l => l.to > l.from),
          groups: rides.map(l => l.route.group),
          startNear: d(first.route.stops[first.from], a) <= ACCESS_MAX_M + 1,
          endNear: d(lastR.route.stops[lastR.to], b) <= ACCESS_MAX_M + 1
        };
      })
    };
  }, [from, to, opts]);
}

test('viaje directo: hasta 3 opciones, hacia adelante y desde/hasta cerca de A y B', async ({ app, page }) => {
  const r = await plan(page, PUENTE_NUEVO, PLAZA_SAN_MARTIN);
  expect(r.walkOnly).toBe(false);
  expect(r.options.length).toBe(3);
  for (const o of r.options){
    expect(o.transfers).toBe(0);
    expect(o.forward).toBe(true);
    expect(o.startNear).toBe(true);
    expect(o.endNear).toBe(true);
    expect(o.old).toBe(false);
  }
  // Ordenadas por tiempo y sin repetir servicio
  const mins = r.options.map(o => o.minutes);
  expect(mins).toEqual([...mins].sort((a, b) => a - b));
  expect(new Set(r.options.map(o => o.services.join('>'))).size).toBe(3);
});

test('lejos: directos primero y luego con un transbordo entre servicios distintos', async ({ app, page }) => {
  const r = await plan(page, VES, COMAS);
  expect(r.options.length).toBeGreaterThan(0);
  const t = r.options.map(o => o.transfers);
  expect(t).toEqual([...t].sort());
  const withTransfer = r.options.filter(o => o.transfers === 1);
  expect(withTransfer.length).toBeGreaterThan(0);
  for (const o of withTransfer){
    expect(o.codes.length).toBe(2);
    expect(o.services[0]).not.toBe(o.services[1]);
    expect(o.forward && o.startNear && o.endNear).toBe(true);
  }
  expect(r.ms).toBeLessThan(2000);
});

test('muy cerca conviene caminar', async ({ app, page }) => {
  const r = await plan(page, PUENTE_NUEVO, { lat: -12.0450, lon: -77.0140 });
  expect(r.walkOnly).toBe(true);
  expect(r.options).toEqual([]);
});

test('rutas antiguas solo si se piden', async ({ app, page }) => {
  const off = await plan(page, VES, COMAS);
  expect(off.options.every(o => !o.groups.includes('antigua'))).toBe(true);
  const on = await plan(page, VES, COMAS, { includeOld: true });
  expect(on.options.length).toBeGreaterThan(0);
  expect(on.options.every(o => o.old === o.groups.includes('antigua'))).toBe(true);
});

test.describe('pestaña Cómo llegar', () => {
  test.beforeEach(async ({ app, page }) => {
    test.skip(!(await app.isBeta()), 'solo con ?beta=1');
    await page.click('#tabTrip');
  });

  const pickStop = async (page, sel, text) => {
    await page.fill(sel, text);
    await expect(page.locator(`.trip-field:has(${sel}) .suggest-item`).first()).toBeVisible();
    await page.keyboard.press('Enter');
  };

  test('origen y destino por paradero: opciones, pasos y el viaje en el mapa', async ({ app, page }) => {
    await pickStop(page, '#tripFrom', 'acho');
    await expect(page.locator('#tripFrom')).toHaveValue('Acho · Rímac');
    await pickStop(page, '#tripTo', 'ovalo higuereta');   // el paradero se llama "Higuereta"
    await expect(page.locator('#tripTo')).toHaveValue('Higuereta · Santiago de Surco');

    const cards = page.locator('.trip-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeLessThanOrEqual(3);
    await expect(cards.first()).toHaveClass(/selected/);
    await expect(cards.first().locator('.trip-meta')).toContainText('min aprox.');
    await expect(cards.first().locator('.trip-step-ride')).not.toHaveCount(0);
    await expect(page.locator('.trip-pin-from')).toHaveCount(1);
    await expect(page.locator('.trip-pin-to')).toHaveCount(1);

    // Otra opción: se expande y se dibuja
    if (await cards.count() > 1){
      await cards.nth(1).click();
      await expect(cards.nth(1)).toHaveClass(/selected/);
      await expect(cards.first().locator('.trip-steps')).toHaveCount(0);
    }

    // "Ver rutas completas" marca sus rutas en la pestaña Rutas
    await page.locator('.trip-card.selected .trip-show').click();
    await expect(page.locator('#onMapCount')).not.toHaveText('0');
  });

  test('elegir en el mapa no abre el panel de rutas; Esc cancela', async ({ app, page }) => {
    await page.click('.trip-field[data-end="from"] .trip-pick');
    await expect(page.locator('html')).toHaveClass(/trip-picking/);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveClass(/trip-picking/);

    await page.click('.trip-field[data-end="from"] .trip-pick');
    await app.setView(PUENTE_NUEVO.lat, PUENTE_NUEVO.lon, 16);
    const p = await app.screenPoint(PUENTE_NUEVO.lat, PUENTE_NUEVO.lon);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#tripFrom')).toHaveValue(/^Punto en el mapa · cerca de /);
    await expect(page.locator('.route-inspector')).toBeHidden();

    await pickStop(page, '#tripTo', 'plaza san martin');
    await expect(page.locator('.trip-card').first()).toBeVisible();

    // Invertir
    const a = await page.inputValue('#tripFrom');
    const b = await page.inputValue('#tripTo');
    await page.click('#tripSwap');
    await expect(page.locator('#tripFrom')).toHaveValue(b);
    await expect(page.locator('#tripTo')).toHaveValue(a);
    await expect(page.locator('.trip-card').first()).toBeVisible();
  });

  test('muy cerca: sugiere caminar; borrar un extremo limpia el resultado', async ({ app, page }) => {
    // Dos puntos a ~150 m, elegidos en el mapa
    await app.setView(PUENTE_NUEVO.lat, PUENTE_NUEVO.lon, 16);
    for (const [end, dLat, dLon] of [['from', 0, 0], ['to', -0.001, -0.001]]){
      await page.click(`.trip-field[data-end="${end}"] .trip-pick`);
      const p = await app.screenPoint(PUENTE_NUEVO.lat + dLat, PUENTE_NUEVO.lon + dLon);
      await page.mouse.click(p.x, p.y);
      await expect(page.locator(end === 'from' ? '#tripFrom' : '#tripTo')).toHaveValue(/^Punto en el mapa/);
    }
    await expect(page.locator('.trip-empty')).toContainText('te conviene caminar');

    await page.click('.trip-field[data-end="to"] .trip-clear');
    await expect(page.locator('#tripResults')).toBeEmpty();
    await expect(page.locator('.trip-pin-to')).toHaveCount(0);
  });
});
