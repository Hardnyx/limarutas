// tests/tripPlanner.spec.js
// "Cómo llegar": cálculo de viajes (tripPlanner.js) y su pestaña en la nueva
// interfaz (tripUi.js).
import { test, expect } from './fixtures.js';

const PUENTE_NUEVO = { lat: -12.0433, lon: -77.0126 };
const PLAZA_SAN_MARTIN = { lat: -12.0515, lon: -77.0347 };
const VES = { lat: -12.2130, lon: -76.9370 };
const COMAS = { lat: -11.9380, lon: -77.0600 };
const SAN_ISIDRO = { lat: -12.0930, lon: -77.0230 };   // Canaval y Moreyra
const VES_MEGA = { lat: -12.2090, lon: -76.9410 };      // Mega Plaza Villa El Salvador

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
    const d2 = (i, j) => d(i, { lat: lat[j], lon: lon[j] });
    return {
      ms,
      walkOnly: res.walkOnly,
      options: res.options.map(opt => {
        const rides = opt.legs.filter(l => l.type === 'ride');
        const first = rides[0], lastR = rides[rides.length - 1];
        // Cada alternativa sube y baja cerca de donde lo hace la ruta del tramo
        const altsOk = rides.every(l => (l.alts || []).every(x =>
          x.to > x.from &&
          d2(x.route.stops[x.from], l.route.stops[l.from]) <= 151 &&
          d2(x.route.stops[x.to], l.route.stops[l.to]) <= 151));
        return {
          mass: opt.mass,
          massGroups: rides.some(l => ['metro', 'metropolitano', 'corredor'].includes(l.route.group)),
          transfers: opt.transfers,
          minutes: opt.minutes,
          cost: opt.cost,
          altsOk,
          alts: rides.map(l => (l.alts || []).map(x => `${x.route.leaf.dataset.system}:${x.route.leaf.dataset.id}`)),
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

test('viaje directo: opciones hacia adelante, cerca de A y B y con rutas alternativas', async ({ app, page }) => {
  const r = await plan(page, PUENTE_NUEVO, PLAZA_SAN_MARTIN);
  expect(r.walkOnly).toBe(false);
  expect(r.options.length).toBeGreaterThan(0);
  expect(r.options.length).toBeLessThanOrEqual(6);
  for (const o of r.options){
    expect(o.forward).toBe(true);
    expect(o.startNear).toBe(true);
    expect(o.endNear).toBe(true);
    expect(o.old).toBe(false);
    expect(o.altsOk).toBe(true);
  }
  // Hay una directa (aunque un transbordo con menos caminata gane) y en
  // algún tramo varias rutas sirven
  expect(r.options.some(o => o.transfers === 0)).toBe(true);
  expect(r.options.some(o => o.alts.some(a => a.length > 0))).toBe(true);
  // Ordenadas por costo y sin repetir la misma ruta como principal
  const costs = r.options.map(o => o.cost);
  expect(costs).toEqual([...costs].sort((a, b) => a - b));
  expect(new Set(r.options.map(o => o.services.join('>'))).size).toBe(r.options.length);
});

test('lejos: los transbordos no repiten rutas que ya van directo', async ({ app, page }) => {
  const r = await plan(page, VES, COMAS);
  expect(r.options.length).toBeGreaterThan(0);
  const direct = new Set(r.options.filter(o => !o.transfers).flatMap(o => [...o.services, ...o.alts[0]]));
  const withTransfer = r.options.filter(o => o.transfers === 1);
  for (const o of withTransfer){
    expect(o.codes.length).toBe(2);
    expect(o.services[0]).not.toBe(o.services[1]);
    expect(o.forward && o.startNear && o.endNear && o.altsOk).toBe(true);
    // Ni la misma ruta en los dos tramos ni, como alternativa, una que ya va directo
    expect(o.alts[1]).not.toContain(o.services[0]);
    expect(o.alts[0]).not.toContain(o.services[1]);
    for (const a of o.alts.flat()) expect(direct.has(a)).toBe(false);
  }
  expect(r.ms).toBeLessThan(3000);
});

test('Metro, Metropolitano o corredor: si se puede ir en ellos, aparece esa opción', async ({ app, page }) => {
  const r = await plan(page, SAN_ISIDRO, VES_MEGA);
  expect(r.options.length).toBeGreaterThan(3);
  const mass = r.options.filter(o => o.mass);
  expect(mass.length).toBeGreaterThan(0);
  for (const o of r.options) expect(o.mass).toBe(o.massGroups);
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
    expect(await cards.count()).toBeLessThanOrEqual(6);
    // Cada ruta con el nombre que la gente conoce (empresa · alias)
    await expect(cards.first().locator('.trip-name').first()).not.toBeEmpty();
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

    // "Ver estas rutas completas" las marca y lleva a la pestaña Rutas
    await page.locator('.trip-card.selected .trip-show').click();
    await expect(page.locator('#tabRoutes')).toHaveAttribute('aria-selected', 'true');
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

  test('cada pestaña muestra lo suyo en el mapa', async ({ app, page }) => {
    await page.click('#tabRoutes');
    await app.search('1240');
    await page.keyboard.press('Enter');
    await app.settle();
    const shown = sel => page.$eval(sel, n => getComputedStyle(n).display !== 'none');
    expect(await shown('.leaflet-overlay-pane')).toBe(true);

    await page.click('#tabTrip');
    expect(await shown('.leaflet-overlay-pane')).toBe(false);
    // La ruta sigue marcada: solo no se ve mientras se planea el viaje
    await expect(app.leaf('wr', '1240')).toBeChecked();
    await pickStop(page, '#tripFrom', 'acho');
    await pickStop(page, '#tripTo', 'ovalo higuereta');
    await expect(page.locator('.trip-card').first()).toBeVisible();
    expect(await shown('.leaflet-tripLine-pane')).toBe(true);

    await page.click('#tabRoutes');
    expect(await shown('.leaflet-overlay-pane')).toBe(true);
    expect(await shown('.leaflet-tripLine-pane')).toBe(false);
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
