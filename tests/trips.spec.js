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
      exp1: ['met:1:ns', 'met:1:sn'].map(k => g.routes.some(x => x.key === k)),
      sxn22: ['met:SXN-22:ns', 'met:SXN-22:sn'].map(k => g.routes.some(x => x.key === k)),
      d: g.routes.some(x => x.key.startsWith('met:D:')),
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
  expect(r.exp1).toEqual([true, true]);
  expect(r.sxn22).toEqual([true, false]);
  // La Ruta D ya no opera
  expect(r.d).toBe(false);
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
      alim: g.routes.filter(x => x.system === 'alim').map(x => x.key),
      codeOf1240: g.routes.find(x => x.key === '1240-ida').code,
      leaves: leaves.length
    };
  });
  for (const k of ['atu', 'corredor', 'aero', 'otros', 'antigua', 'metropolitano', 'alimentador', 'metro']){
    expect(r.groups[k], k).toBeGreaterThan(0);
  }
  expect(r.allHaveLeaf).toBe(true);
  // Alimentadores: cada circuito en ida y vuelta
  expect(r.alim).toEqual(expect.arrayContaining(['alim:AN-01:ida', 'alim:AN-01:vuelta', 'alim:AS-04:ida']));
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

test('Metropolitano: el tiempo a bordo se mide por la vía, no en línea recta', async ({ app, page }) => {
  const r = await withGraph(page, (g) => {
    const a = g.routes.find(x => x.key === 'met:A:ns');
    const { lat, lon } = g.stops;
    let straight = 0;
    for (let i = 0; i + 1 < a.stops.length; i++){
      const p = a.stops[i], q = a.stops[i + 1];
      straight += Math.hypot((lon[p] - lon[q]) * 108_900, (lat[p] - lat[q]) * 110_574);
    }
    return { n: a.segM?.length, stops: a.stops.length, byWay: a.segM?.reduce((s, m) => s + m, 0), straight };
  });
  expect(r.n).toBe(r.stops - 1);
  // Por la vía siempre es algo más largo que en recta, pero no absurdo
  expect(r.byWay).toBeGreaterThan(r.straight);
  expect(r.byWay).toBeLessThan(r.straight * 1.3);
});

test('Alimentadores: el circuito se corta en el terminal y en el punto más lejano; comparte la estación con el Metropolitano', async ({ app, page }) => {
  const r = await withGraph(page, (g) => {
    const ida = g.routes.find(x => x.key === 'alim:AS-04:ida');
    const vta = g.routes.find(x => x.key === 'alim:AS-04:vuelta');
    const c = g.routes.find(x => x.key === 'met:C:ns');
    const name = i => g.stops.name[i];
    return {
      idaFirst: name(ida.stops[0]), vtaLast: name(vta.stops[vta.stops.length - 1]),
      // La estación Matellini es el mismo nodo en el alimentador y en la Ruta C
      shared: c.stops.includes(ida.stops[0]),
      idaSeg: ida.segM?.length === ida.stops.length - 1,
      // Paraderos oficiales del portal de la ATU (config/alim_paraderos.json)
      as07: Array.from(g.routes.find(x => x.key === 'alim:AS-07:ida').stops, name),
      as02: Array.from(g.routes.find(x => x.key === 'alim:AS-02:vuelta').stops, name)
    };
  });
  expect(r.idaFirst).toBe('Matellini');
  expect(r.vtaLast).toBe('Matellini');
  expect(r.shared).toBe(true);
  expect(r.idaSeg).toBe(true);
  expect(r.as07).toEqual(['Matellini', 'Óvalo La Curva', 'Guardia Peruana', 'El Sol', 'Paradero C', 'Los Naranjos',
    'Calle 3', 'Velasco Alvarado', 'Santa Rosa', 'Mártir Olaya', 'Mártires', 'Unión', 'Panamericana']);
  expect(r.as02).toEqual(['Isla Española', 'Aruba', 'Las Tortugas', 'Cedros de Villa', 'San Lorenzo', 'Plaza Vea',
    'Machupicchu', '10 de Noviembre', 'Santa Anita', 'Matellini']);
});

test('Transporte público: solo los códigos del PRR; los antiguos de 4 dígitos van a Rutas antiguas', async ({ app, page }) => {
  const r = await withGraph(page, g => {
    const group = key => g.routes.find(x => x.key === key)?.group;
    return {
      // 1188 es la antigua 1324; 1209, la 1003; 2305 (trazado 69457), la 1469
      old: ['1188-ida', '1209-ida', '2305-ida', '1101-ida', '1402-ida'].map(group),
      prr: ['1324-ida', '1469-ida', '1288-ida'].map(group)
    };
  });
  expect(r.old).toEqual(['antigua', 'antigua', 'antigua', 'antigua', 'antigua']);
  expect(r.prr).toEqual(['atu', 'atu', 'atu']);

  // El catálogo trae exactamente las rutas del cuadro de equivalencias
  const [catalog, fichas] = await page.evaluate(() => Promise.all([
    fetch('/config/catalog.json').then(r => r.json()),
    fetch('/pipeline/output/prr_fichas.json').then(r => r.json())
  ]));
  expect([...catalog.transporte.only].sort()).toEqual(Object.keys(fichas.rutas).sort());
});
