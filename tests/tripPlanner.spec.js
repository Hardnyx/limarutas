// tests/tripPlanner.spec.js
// "Cómo llegar": cálculo de viajes (tripPlanner.js) y su pestaña en la nueva
// interfaz (tripUi.js).
import { test, expect } from './fixtures.js';
import path from 'node:path';

const LEAFLET_DIST = path.resolve('node_modules/leaflet/dist');

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
    const { planTrip, ACCESS_MAX_M, DIRECT_ACCESS_MAX_M } = await import('/assets/js/tripPlanner.js');
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
          // Rutas únicas: hasta 1,3 km en un extremo; con transbordo, 800 m
          startNear: d(first.route.stops[first.from], a) <= (opt.transfers ? ACCESS_MAX_M : DIRECT_ACCESS_MAX_M) + 1,
          endNear: d(lastR.route.stops[lastR.to], b) <= (opt.transfers ? ACCESS_MAX_M : DIRECT_ACCESS_MAX_M) + 1
        };
      })
    };
  }, [from, to, opts]);
}

test('viaje directo: opciones hacia adelante, cerca de A y B y con rutas alternativas', async ({ app, page }) => {
  // De noche, sin congestión (con tráfico, el directo por Abancay deja de ser cómodo)
  const r = await plan(page, PUENTE_NUEVO, PLAZA_SAN_MARTIN, { at: { day: 2, min: 22 * 60 + 30 } });
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
  // Primero una ruta única (hay una con poca caminata) y sin repetir la misma ruta como principal
  expect(r.options[0].transfers).toBe(0);
  expect(new Set(r.options.map(o => o.services.join('>'))).size).toBe(r.options.length);
});

test('congestión: en hora punta el tramo por Abancay y Grau dura más; de noche, no', async ({ app, page }) => {
  const r = await page.evaluate(async () => {
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const { planTrip, congestionWeight } = await import('/assets/js/tripPlanner.js');
    const g = await loadTripGraph();
    const ride = at => {
      const res = planTrip(g, { lat: -12.0433, lon: -77.0126 }, { lat: -12.0515, lon: -77.0347 }, { at });
      return Math.min(...res.options.filter(o => !o.transfers).map(o => o.minutes));
    };
    const r1481 = g.routes.find(x => x.key === '1481-ida');
    // El Corredor Azul por la vía exclusiva de Arequipa va más rápido (% negativo)
    const r301 = g.routes.find(x => x.key === '301-ida');
    return {
      w: [congestionWeight({ day: 2, min: 7 * 60 + 30 }), congestionWeight({ day: 2, min: 12 * 60 }),
          congestionWeight({ day: 0, min: 12 * 60 }), congestionWeight({ day: 2, min: 23 * 60 })],
      // La 1481 baja por Grau y sube por Abancay: esos tramos llevan % extra
      slowMax: Math.max(...(r1481.slow || [0])),
      exclusiveMin: Math.min(...(r301.slow || [0])),
      peak: ride({ day: 2, min: 7 * 60 + 30 }), night: ride({ day: 2, min: 22 * 60 + 30 })
    };
  });
  expect(r.w).toEqual([1, 0.5, 0.2, 0]);
  expect(r.slowMax).toBeGreaterThanOrEqual(30);
  expect(r.exclusiveMin).toBeLessThanOrEqual(-30);
  expect(r.peak).toBeGreaterThan(r.night);
});

test('Metropolitano con cambio de servicio y luego un bus (Habich → San Rodolfo: B › Expreso 1 a Matellini › 1087)', async ({ app, page }) => {
  const r = await plan(page, { lat: -12.0233, lon: -77.0498 }, { lat: -12.1888, lon: -77.0132 }, { at: { day: 2, min: 11 * 60 + 33 } });
  const first = r.options[0];
  expect(first.groups).toEqual(['metropolitano', 'metropolitano', 'atu']);
  expect(first.codes[2]).toBe('1087');
  expect(first.transfers).toBe(2);
});

test('hora punta de la tarde: el bus por la pista tarda bastante más; el Metropolitano no', async ({ app, page }) => {
  const r = await page.evaluate(async () => {
    const { busPeakFactor } = await import('/assets/js/tripPlanner.js');
    return [busPeakFactor({ day: 2, min: 17 * 60 + 15 }), busPeakFactor({ day: 2, min: 7 * 60 + 30 }),
            busPeakFactor({ day: 2, min: 11 * 60 }), busPeakFactor({ day: 0, min: 18 * 60 })];
  });
  expect(r).toEqual([1.8, 1.5, 1, 1]);
  // Saga Falabella Las Begonias → Amazonas en la 1056
  const ride = async min => {
    const res = await plan(page, { lat: -12.0944, lon: -77.0252 }, { lat: -12.0451, lon: -77.0252 }, { at: { day: 2, min } });
    return res.options.find(o => o.codes.join() === '1056')?.minutes;
  };
  const midday = await ride(11 * 60 + 33), peak = await ride(17 * 60 + 15);
  expect(peak).toBeGreaterThan(midday * 1.6);
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

test('una ruta única con poca caminata va antes que un transbordo (Canaval y Moreyra → Mariátegui)', async ({ app, page }) => {
  // Revisado a mano: la 1122 va directo (750 m a pie en total, ~82 min); el
  // mejor transbordo (1057 › 1185) apenas ahorra 2 min y obliga a cambiar en Atocongo
  const r = await plan(page, { lat: -12.09805, lon: -77.02017 }, { lat: -12.2177, lon: -76.9273 });
  expect(r.options[0].codes).toEqual(['1122']);
  expect(r.options[0].transfers).toBe(0);
  // Las otras rutas únicas, con más caminata, también aparecen: la 1297 y la
  // 1244 (La 73-1), que pasa a 1,25 km de B
  for (const code of ['1297', '1244']){
    expect(r.options.some(o => o.codes.length === 1 && o.codes[0] === code), code).toBe(true);
  }
  // Los transbordos no empiezan todos con las mismas rutas
  const starts = r.options.filter(o => o.transfers).map(o => o.services[0]);
  for (const s of new Set(starts)) expect(starts.filter(x => x === s).length).toBeLessThanOrEqual(2);
});

test('Metropolitano + corredor va primero si es más rápido que el directo sin mucha más caminata (Habich → Monumental)', async ({ app, page }) => {
  // Lunes 15:57 (circula el Expreso 5). La 1191 va directo en ~96 min con
  // ~600 m a pie; Expreso 5 › Corredor Rojo tarda ~87 min con ~300 m más
  const r = await plan(page, { lat: -12.0225, lon: -77.0516 }, { lat: -12.058, lon: -76.9395 }, { at: { day: 1, min: 957 } });
  const first = r.options[0];
  expect(first.transfers).toBe(1);
  expect(first.groups.every(g => ['metro', 'metropolitano', 'corredor'].includes(g))).toBe(true);
  // El directo sigue apareciendo, detrás
  const direct = r.options.find(o => o.transfers === 0);
  expect(direct).toBeTruthy();
  expect(first.minutes).toBeLessThan(direct.minutes);
});

test('Metropolitano: solo entra lo que circula a la hora de salida', async ({ app, page }) => {
  const r = await page.evaluate(async ([a, b]) => {
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const { planTrip } = await import('/assets/js/tripPlanner.js');
    const g = await loadTripGraph();
    // day: 0 = domingo; min: minutos desde la medianoche (hora de Lima)
    const on = (key, day, h, m = 0) =>
      g.activeRoutes({ at: { day, min: h * 60 + m } }).some(x => x.key === key);
    const met = (day, h, m = 0) => planTrip(g, a, b, { at: { day, min: h * 60 + m } }).options
      .flatMap(o => o.legs).filter(l => l.type === 'ride' && l.route.group === 'metropolitano').length;
    return {
      e6: [on('met:6:ns', 2, 7), on('met:6:ns', 2, 10, 30), on('met:6:ns', 6, 7)],
      e5: [on('met:5:ns', 3, 12), on('met:5:ns', 6, 6), on('met:5:ns', 0, 12)],
      // Lechucero: viernes y sábado de 23:30 a 4:00
      lech: [on('met:L:ns', 5, 23, 45), on('met:L:ns', 6, 2), on('met:L:ns', 0, 2), on('met:L:ns', 1, 2), on('met:L:ns', 5, 22)],
      // El resto de rutas no tiene horario
      bus: on('1122-ida', 0, 3),
      metDay: met(2, 10, 30),
      metNight: met(0, 23, 30)
    };
  }, [SAN_ISIDRO, VES_MEGA]);
  expect(r.e6).toEqual([true, false, false]);
  expect(r.e5).toEqual([true, true, false]);
  expect(r.lech).toEqual([true, true, true, false, false]);
  expect(r.bus).toBe(true);
  expect(r.metDay).toBeGreaterThan(0);
  expect(r.metNight).toBe(0);
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

test('la espera sale del intervalo de la ficha técnica y entra en el tiempo estimado', async ({ app, page }) => {
  const r = await page.evaluate(async () => {
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const { planTrip, headwayOf } = await import('/assets/js/tripPlanner.js');
    const g = await loadTripGraph();
    // Canaval y Moreyra → Mariátegui: la 1122 directa (pasa cada 8 min según su ficha)
    const res = planTrip(g, { lat: -12.09805, lon: -77.02017 }, { lat: -12.2177, lon: -76.9273 });
    const opt = res.options[0];
    const ride = opt.legs.find(l => l.type === 'ride');
    const routes = [ride.route, ...ride.alts.map(a => a.route)];
    return {
      code: ride.route.code,
      headway: ride.route.headway,
      wait: ride.wait,
      expected: 1 / (2 * routes.reduce((s, x) => s + 1 / headwayOf(x), 0)),
      oldHeadway: headwayOf(g.routes.find(x => x.group === 'antigua'))
    };
  });
  expect(r.code).toBe('1122');
  expect(r.headway).toBe(8);
  expect(r.wait).toBeCloseTo(r.expected, 5);
  expect(r.wait).toBeLessThanOrEqual(4);
  // Sin ficha (ruta antigua), un intervalo conservador
  expect(r.oldHeadway).toBe(20);
});

test.describe('pestaña Cómo llegar', () => {
  test.beforeEach(async ({ app, page }) => {
    test.skip(!(await app.isBeta()), 'solo en la nueva interfaz');
    await page.click('#tabTrip');
  });

  const pickStop = async (page, sel, text) => {
    await page.fill(sel, text);
    await expect(page.locator(`.trip-field:has(${sel}) .suggest-item`).first()).toBeVisible();
    await page.keyboard.press('Enter');
  };

  test('sin A y B se explica cómo empezar; un texto sin paraderos lo dice', async ({ app, page }) => {
    await expect(page.locator('.trip-help')).toBeVisible();
    await expect(page.locator('.trip-help .ico-pin')).toBeVisible();
    await expect(page.locator('#tripDay option[value="now"]')).toHaveText(/^Ahora \(\d{1,2}:\d\d\)$/);
    await page.fill('#tripFrom', 'zzqxw');
    await expect(page.locator('.trip-field:has(#tripFrom) .suggest-empty')).toBeVisible();
    await expect(page.locator('.trip-field:has(#tripFrom) .suggest-item')).toHaveCount(0);

    // Con resultados, la ayuda se va
    await page.evaluate(async () => {
      const m = await import('/assets/js/tripUi.js');
      await m.setTripEnds({ lat: -12.09805, lon: -77.02017, label: 'A' }, { lat: -12.2177, lon: -76.9273, label: 'B' });
    });
    await expect(page.locator('.trip-card').first()).toBeVisible();
    await expect(page.locator('.trip-help')).toBeHidden();
    // Cada cuánto pasa (ficha técnica) y cuánto se espera
    await expect(page.locator('.trip-card').first().locator('.trip-step-ride .trip-hours'))
      .toContainText(/Pasa cada ~8 min según la ATU · espera ~\d+ min/);
  });

  test('las rutas se muestran con su alias ("La 35A") y el código de 4 dígitos aparte', async ({ app, page }) => {
    const short = await page.evaluate(async () => {
      const { wrShortAlias } = await import('/assets/js/wrTexts.js');
      return ['La 9 - La Banchero', 'La U - La A - La B - La C', 'El Chosicano', 'Desconocido', 'la 87b', '']
        .map(wrShortAlias);
    });
    expect(short).toEqual(['La 9', 'La U', 'El Chosicano', '', 'La 87B', '']);

    // Habich → Estadio Monumental: la 1191 es "la 35A"
    await page.evaluate(async () => {
      const m = await import('/assets/js/tripUi.js');
      await m.setTripEnds({ lat: -12.0225, lon: -77.0516, label: 'A' }, { lat: -12.058, lon: -76.9395, label: 'B' });
    });
    const card = page.locator('.trip-card', { has: page.locator('.trip-strip .trip-chip', { hasText: /^La 35A$/ }) }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.trip-name').first()).toContainText('ruta 1191');
    await card.click();
    const step = card.locator('.trip-step-ride').first();
    await expect(step).toContainText(/^Sube a La 35A en /);
    await expect(step).toContainText('ruta 1191');
  });

  test('origen y destino por paradero: opciones, pasos y el viaje en el mapa', async ({ app, page }) => {
    await pickStop(page, '#tripFrom', 'acho');
    // Con su cruce, para distinguirlo de otros del mismo nombre
    await expect(page.locator('#tripFrom')).toHaveValue(/^Acho · .+ · Rímac$/);
    await pickStop(page, '#tripTo', 'ovalo higuereta');   // el paradero se llama "Higuereta"
    await expect(page.locator('#tripTo')).toHaveValue(/^Higuereta.* · Santiago de Surco$/);

    const cards = page.locator('.trip-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeLessThanOrEqual(6);
    // Cada ruta con el nombre que la gente conoce (empresa · alias)
    await expect(cards.first().locator('.trip-name').first()).not.toBeEmpty();
    await expect(cards.first()).toHaveClass(/selected/);
    await expect(cards.first().locator('.trip-time')).toContainText('min');
    await expect(cards.first().locator('.trip-meta')).toHaveText(/a pie|sin caminar/);
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

  test('los tramos a pie van por las calles (red peatonal de OSM), no en línea recta', async ({ app, page }) => {
    const tiles = [];
    page.on('request', r => { if (r.url().includes('/data/processed/caminata/t/')) tiles.push(r.url()); });
    await page.evaluate(async () => {
      const m = await import('/assets/js/tripUi.js');
      await m.setTripEnds({ lat: -12.0225, lon: -77.0516, label: 'A' }, { lat: -12.058, lon: -76.9395, label: 'B' });
    });
    await expect(page.locator('.trip-card').first()).toBeVisible();
    // Por las calles: el tramo tiene esquinas
    await expect.poll(() => app.state(state => {
      const walks = [];
      state.map.eachLayer(l => { if (l instanceof L.Polyline && l.options.dashArray === '2 8') walks.push(l.getLatLngs().length); });
      return walks.length > 0 && walks.every(n => n >= 4);
    })).toBe(true);
    expect(tiles.length).toBeGreaterThan(0);
  });

  test('a pie: sin pasar por dentro de una estación del Metropolitano', async ({ page }) => {
    // De un lado al otro de la Vía Expresa junto a Canaval y Moreyra: por el
    // puente, no por los pasillos de la estación (que dan a la vía exclusiva)
    const r = await page.evaluate(async () => {
      const { walkRoute } = await import('/assets/js/walkRoute.js');
      const w = await walkRoute([-12.0968, -77.0244], [-12.0971, -77.0258]);
      // Pasillos cubiertos de la estación (OSM 1554653641, 1554653643)
      const inside = [[-12.096988, -77.025109], [-12.096648, -77.024986]];
      const near = (p, q) => Math.hypot((p[0] - q[0]) * 110574, (p[1] - q[1]) * 108900) < 4;
      return w && { n: w.coords.length, inStation: w.coords.some(p => inside.some(q => near(p, q))) };
    });
    expect(r).not.toBeNull();
    expect(r.n).toBeGreaterThan(4);
    expect(r.inStation).toBe(false);
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
    await expect(page.locator('#tripFrom')).toHaveValue(/^Cerca de /);
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

  test('el viaje queda en la URL y se abre desde un enlace', async ({ app, page }) => {
    await pickStop(page, '#tripFrom', 'acho');
    await pickStop(page, '#tripTo', 'ovalo higuereta');
    await expect(page.locator('.trip-card').first()).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get('desde')).toMatch(/^-1\d\.\d{5},-7\d\.\d{5}$/);
    expect(url.searchParams.get('hasta')).toMatch(/^-1\d\.\d{5},-7\d\.\d{5}$/);
    await expect(page.locator('.trip-card.selected .trip-share')).toBeVisible();

    // Abrir ese enlace en otra pestaña calcula el mismo viaje
    const other = await page.context().newPage();
    await other.route('https://unpkg.com/**', r => r.fulfill({
      path: path.join(LEAFLET_DIST, r.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js') }));
    await other.route('https://*.basemaps.cartocdn.com/**', r => r.fulfill({ status: 204 }));
    await other.goto(url.pathname + url.search);
    await expect(other.locator('#status')).toHaveText('Listo', { timeout: 90_000 });
    await expect(other.locator('#tabTrip')).toHaveAttribute('aria-selected', 'true');
    await expect(other.locator('.trip-card').first()).toBeVisible({ timeout: 30_000 });
    await expect(other.locator('#tripFrom')).toHaveValue(/cerca de Acho|Acho/);
    await other.close();

    // Borrar un extremo lo quita de la URL
    await page.click('.trip-field[data-end="to"] .trip-clear');
    expect(new URL(page.url()).searchParams.get('hasta')).toBeNull();
  });

  test('desde el panel de un paradero: Salir de aquí / Llegar aquí', async ({ app, page }) => {
    await page.click('#tabRoutes');
    const items = await app.search('puente nuevo');
    await items.first().click();
    await expect(page.locator('.route-inspector .ri-trip')).toBeVisible();
    await page.click('.route-inspector .ri-trip [data-end="from"]');
    await expect(page.locator('#tabTrip')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tripFrom')).toHaveValue('Puente Nuevo · El Agustino');
    await expect(page.locator('.route-inspector')).toBeHidden();
  });

  test('Metropolitano: el tramo va por la macroruta y muestra cada estación', async ({ app, page }) => {
    // Canaval y Moreyra → Villa El Salvador: hay una opción en Metropolitano
    const { lat, lon } = { lat: -12.0930, lon: -77.0230 };
    await page.evaluate(async ([a, b]) => {
      const m = await import('/assets/js/tripUi.js');
      await m.setTripEnds({ ...a, label: 'A' }, { ...b, label: 'B' });
    }, [{ lat, lon }, { lat: -12.2090, lon: -76.9410 }]);
    const met = page.locator('.trip-card', { hasText: 'Metropolitano' }).first();
    await expect(met).toBeVisible();
    await met.click();
    const r = await app.state(s => {
      let lines = 0, maxPts = 0, dots = 0;
      s.map.eachLayer(l => {
        if (l.options?.pane === 'tripLinePane' && l.getLatLngs){ lines++; maxPts = Math.max(maxPts, l.getLatLngs().length); }
        if (l.options?.pane === 'tripMarkPane' && l.getRadius) dots++;
      });
      return { lines, maxPts, dots };
    });
    // El trazado por la vía tiene muchos más puntos que las estaciones del tramo
    expect(r.maxPts).toBeGreaterThan(30);
    // La primera opción es la recomendada; si la más rápida es otra, lo dice
    await expect(page.locator('.trip-card').first().locator('.trip-badge')).toHaveText('Recomendada');
    await expect(page.locator('.trip-badge', { hasText: 'Recomendada' })).toHaveCount(1);
    expect(r.dots).toBeGreaterThan(6);
  });

  test('Salida: el horario del Metropolitano sale en el paso y, fuera de hora, se avisa', async ({ app, page }) => {
    // La página está en martes 10:30 (fixtures.js): circulan la C y el Expreso 1
    await page.evaluate(async ([a, b]) => {
      const m = await import('/assets/js/tripUi.js');
      await m.setTripEnds({ ...a, label: 'A' }, { ...b, label: 'B' });
    }, [SAN_ISIDRO, VES_MEGA]);
    await expect(page.locator('#tripDay')).toHaveValue('now');
    await expect(page.locator('#tripTime')).toBeHidden();
    const met = page.locator('.trip-card', { hasText: 'Metropolitano' }).first();
    await met.click();
    await expect(met.locator('.trip-hours').first()).toHaveText(/^Horario: .*\d:\d\d–\d{1,2}:\d\d/);

    // Domingo 23:30: ya no hay Metropolitano; se avisa cuál serviría y su horario
    await page.selectOption('#tripDay', '0');
    await page.fill('#tripTime', '23:30');
    await page.locator('#tripTime').dispatchEvent('change');
    await expect(page.locator('.trip-card', { hasText: 'Metropolitano' })).toHaveCount(0);
    await expect(page.locator('.trip-offhours')).toContainText('En otro horario también te sirve');
    await expect(page.locator('.trip-offhours .trip-sub').first()).toHaveText(/\d:\d\d–\d/);
    // Tocarlo busca con su próximo horario (el lunes temprano) y vuelve el Metropolitano
    await page.locator('.trip-offhours-item').first().click();
    await expect(page.locator('#tripDay')).toHaveValue('1');
    await expect(page.locator('#tripTime')).toHaveValue(/^0[5-9]:\d\d$/);
    await expect(page.locator('.trip-card', { hasText: 'Metropolitano' }).first()).toBeVisible();
  });

  test('elegir en el mapa: libre, salvo que el clic caiga encima de un paradero', async ({ app, page }) => {
    const stop = await page.evaluate(async () => {
      const { loadTripGraph } = await import('/assets/js/tripData.js');
      const g = await loadTripGraph();
      const i = g.nearestStops(-12.0433, -77.0126, 300)[0][0];
      const lat = g.stops.lat[i], lon = g.stops.lon[i];
      // Un punto a unos 150 m sin paraderos a menos de 80 m
      let free = null;
      for (let a = 0; a < 16 && !free; a++){
        const la = lat + 0.00135 * Math.cos(a * Math.PI / 8), lo = lon + 0.00135 * Math.sin(a * Math.PI / 8);
        if (!g.nearestStops(la, lo, 80).length) free = { lat: la, lon: lo };
      }
      return { lat, lon, name: g.stops.name[i], district: g.stops.district[i], free };
    });
    await app.setView(stop.lat, stop.lon, 17);
    const end = () => app.state(async () => {
      const u = new URL(location.href).searchParams.get('desde');
      return u && u.split(',').map(Number);
    });

    // ~8 m del paradero (unos pocos píxeles a zoom 17): se ajusta a él
    await page.click('.trip-field[data-end="from"] .trip-pick');
    let p = await app.screenPoint(stop.lat + 0.00007, stop.lon);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#tripFrom')).toHaveValue(`${stop.name} · ${stop.district}`);
    await expect.poll(end).toEqual([+stop.lat.toFixed(5), +stop.lon.toFixed(5)]);

    // ~150 m, lejos de otros paraderos: queda donde se tocó
    expect(stop.free).not.toBeNull();
    await page.click('.trip-field[data-end="from"] .trip-pick');
    p = await app.screenPoint(stop.free.lat, stop.free.lon);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#tripFrom')).toHaveValue(/^(Cerca de|Punto en el mapa)/);
  });

  test('muy cerca: sugiere caminar; borrar un extremo limpia el resultado', async ({ app, page }) => {
    // Dos puntos a ~150 m, elegidos en el mapa
    await app.setView(PUENTE_NUEVO.lat, PUENTE_NUEVO.lon, 16);
    for (const [end, dLat, dLon] of [['from', 0, 0], ['to', -0.001, -0.001]]){
      await page.click(`.trip-field[data-end="${end}"] .trip-pick`);
      const p = await app.screenPoint(PUENTE_NUEVO.lat + dLat, PUENTE_NUEVO.lon + dLon);
      await page.mouse.click(p.x, p.y);
      // Libre ("Cerca de…") o, si cayó encima de un paradero, ese paradero
      await expect(page.locator(end === 'from' ? '#tripFrom' : '#tripTo')).not.toHaveValue('');
    }
    await expect(page.locator('.trip-empty')).toContainText('te conviene caminar');

    await page.click('.trip-field[data-end="to"] .trip-clear');
    await expect(page.locator('#tripResults')).toBeEmpty();
    await expect(page.locator('.trip-pin-to')).toHaveCount(0);
  });
});

test.describe('Cómo llegar en hora punta de la tarde', () => {
  // Martes 18:30 en Lima: circula el Expreso 2, que no para en Canaval y Moreyra
  test.use({ startTab: 'default', clockAt: '2026-09-29T23:30:00Z' });

  test('si se camina a una estación más lejana, el paso dice por qué', async ({ app, page }) => {
    test.skip(!(await app.isBeta()), 'solo en la nueva interfaz');
    await page.click('#tabTrip');
    await page.evaluate(async () => {
      const m = await import('/assets/js/tripUi.js');
      // Centro Financiero de San Isidro (a 200 m de Canaval y Moreyra) → Naranjal
      await m.setTripEnds({ lat: -12.0957, lon: -77.0262, label: 'A' }, { lat: -11.9821, lon: -77.0587, label: 'B' });
    });
    const card = page.locator('.trip-card', { has: page.locator('.trip-name', { hasText: 'Expreso 2' }) }).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(card.locator('.trip-why')).toHaveText('El Expreso 2 no para en Canaval y Moreyra, que está más cerca');
  });
});
