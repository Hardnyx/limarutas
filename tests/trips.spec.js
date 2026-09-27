// tests/trips.spec.js
// Datos para "Cómo llegar" (tripData.js + pipeline/output/trip_graph.json):
// paraderos en orden por ruta y sentido, qué rutas entran y caminatas.
import { test, expect } from './fixtures.js';

// Corre fn(graph, arg) en la página con el grafo cargado
function withGraph(page, fn, arg){
  return page.evaluate(async ([src, a]) => {
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const g = await loadTripGraph();
    return (0, eval)(src)(g, a);
  }, [fn.toString(), arg]);
}

test('cada ruta trae sus paraderos en el orden del recorrido', async ({ app, page }) => {
  const r = await withGraph(page, g => {
    const names = key => Array.from(g.routes.find(x => x.key === key).stops, i => g.stops.name[i]);
    const ida = names('1240-ida');
    return {
      ida: [ida[0], ida.length],
      group: g.routes.find(x => x.key === '1240-ida').group,
      l1: names('metro:L1:0'),
      l1back: names('metro:L1:1'),
      a: names('met:A:ns'),
      aBack: names('met:A:sn'),
      // Expresos de un solo sentido: el 6 solo va al sur, el 9 solo al norte
      e6: ['met:6:ns', 'met:6:sn'].map(k => g.routes.some(x => x.key === k)),
      e9: ['met:9:ns', 'met:9:sn'].map(k => g.routes.some(x => x.key === k)),
      exp1: g.routes.some(x => x.key.startsWith('met:1:')),
      sched: g.routes.find(x => x.key === 'met:5:ns').schedule?.length
    };
  });
  expect(r.ida).toEqual(['Las Palmas', 144]);
  expect(r.group).toBe('atu');
  // Línea 1: de un extremo al otro y al revés
  expect([r.l1[0], r.l1.at(-1)].sort()).toEqual(['Bayóvar', 'Villa El Salvador']);
  expect(r.l1.length).toBe(26);
  expect(r.l1back).toEqual([...r.l1].reverse());
  // Regular A: Naranjal ↔ Estación Central por Tacna y Jirón de la Unión,
  // con el andén de cada sentido
  expect([r.a[0], r.a.at(-1)]).toEqual(['Naranjal', 'Estación Central']);
  expect(r.a).toContain('Tacna Sur');
  expect(r.aBack).toContain('Tacna Norte');
  expect([r.aBack[0], r.aBack.at(-1)]).toEqual(['Estación Central', 'Naranjal']);
  expect(r.e6).toEqual([true, false]);
  expect(r.e9).toEqual([false, true]);
  // Fuera de la lista de horarios vigente
  expect(r.exp1).toBe(false);
  expect(r.sched).toBe(2);
});

test('solo entran las rutas que están en el sidebar, con su grupo', async ({ app, page }) => {
  const r = await withGraph(page, g => {
    const groups = {};
    g.routes.forEach(x => { groups[x.group] = (groups[x.group] || 0) + 1; });
    const leaves = document.querySelectorAll('#panels .item .item-head input[data-system]');
    return {
      groups,
      allHaveLeaf: g.routes.every(x => x.leaf && x.leaf.isConnected),
      noAlim: !g.routes.some(x => x.system === 'alim'),
      codeOf1240: g.routes.find(x => x.key === '1240-ida').code,
      leaves: leaves.length
    };
  });
  for (const k of ['atu', 'corredor', 'aero', 'otros', 'antigua', 'metropolitano', 'metro']){
    expect(r.groups[k], k).toBeGreaterThan(0);
  }
  expect(r.allHaveLeaf).toBe(true);
  expect(r.noAlim).toBe(true);
  expect(r.codeOf1240).toBe('1240');
});

test('rutas antiguas: fuera por defecto salvo las verificadas', async ({ app, page }) => {
  const before = await withGraph(page, g => ({
    old: g.routes.filter(x => x.group === 'antigua').length,
    verified: g.routes.filter(x => x.group === 'antigua' && x.verified).length,
    active: g.activeRoutes().some(x => x.group === 'antigua'),
    withOld: g.activeRoutes({ includeOld: true }).filter(x => x.group === 'antigua').length
  }));
  expect(before.old).toBeGreaterThan(500);
  expect(before.verified).toBe(0);
  expect(before.active).toBe(false);
  expect(before.withOld).toBe(before.old);

  // Con un código en catalog.semiformal.verificadas, esa ruta entra por defecto
  const code = await page.$eval('#p-wr-semi .item .item-head input', c => c.dataset.id);
  const after = await page.evaluate(async (c) => {
    const { state } = await import('/assets/js/config.js');
    state.catalog.semiformal.verificadas = [c];
    const { loadTripGraph } = await import('/assets/js/tripData.js');
    const g = await loadTripGraph({ force: true });
    return g.activeRoutes().filter(x => x.group === 'antigua').map(x => x.leaf.dataset.id);
  }, code);
  expect(after.length).toBeGreaterThan(0);
  expect(new Set(after)).toEqual(new Set([code]));
});

test('vía principal y auxiliar: paraderos distintos unidos por una caminata corta', async ({ app, page }) => {
  const r = await withGraph(page, g => {
    const find = nm => g.stops.name.findIndex(n => n === nm);
    const main = find('Control');
    const aux = find('Control (Auxiliar)');
    const walk = g.walkFrom(aux).find(([j]) => j === main);
    return { main, aux, walk: walk && Math.round(walk[1]), district: g.stops.district[aux] };
  });
  expect(r.main).toBeGreaterThanOrEqual(0);
  expect(r.aux).toBeGreaterThanOrEqual(0);
  expect(r.main).not.toBe(r.aux);
  expect(r.walk).toBeLessThan(60);
  expect(r.district).toBe('San Martín de Porres');
});

test('paraderos cercanos a un punto, del más cercano al más lejano', async ({ app, page }) => {
  const r = await withGraph(page, g => {
    // Puente Nuevo (El Agustino)
    const i = g.stops.name.findIndex(n => n === 'Puente Nuevo');
    const near = g.nearestStops(g.stops.lat[i], g.stops.lon[i], 300);
    const walks = g.walkFrom(i);
    return {
      first: near[0] && g.stops.name[near[0][0]],
      sorted: near.every((x, k) => k === 0 || near[k - 1][1] <= x[1]),
      max: Math.max(...near.map(x => x[1])),
      walkMax: Math.max(...walks.map(x => x[1])),
      self: walks.some(([j]) => j === i),
      routesHere: g.atStop[i].length
    };
  });
  expect(r.first).toBe('Puente Nuevo');
  expect(r.sorted).toBe(true);
  expect(r.max).toBeLessThanOrEqual(300);
  expect(r.walkMax).toBeLessThanOrEqual(400);
  expect(r.self).toBe(false);
  expect(r.routesHere).toBeGreaterThan(20);
});

test('los typos de config/stop_name_fixes.json no llegan al mapa ni al buscador', async ({ app, page }) => {
  const r = await page.evaluate(async () => {
    const fixes = (await (await fetch('/config/stop_name_fixes.json')).json()).fixes;
    const graph = await (await fetch('/pipeline/output/trip_graph.json')).json();
    const index = await (await fetch('/pipeline/output/wr_stops_index.json')).json();
    const names = [...graph.stops.map(s => s[2]), ...index.stops.map(s => s[0])];
    return fixes.map(f => names.filter(n => new RegExp(`\\b${f.from}\\b`, 'i').test(n)).length);
  });
  expect(r.every(n => n === 0)).toBe(true);
});
