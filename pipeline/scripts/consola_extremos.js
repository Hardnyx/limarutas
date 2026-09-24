// Pegar en la consola del navegador con la página del mapa abierta.
// Cuenta qué paraderos extremos (inicio/fin) se repiten entre rutas.
// Después: extremos.buscar('abancay')
(async () => {
  const [ext, map] = await Promise.all([
    fetch('pipeline/output/wr_extremes.json').then(r => r.json()),
    fetch('pipeline/output/wr_map.json').then(r => r.json())
  ]);
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // "Terminal Minka", "Paradero Minka" y "Minka" cuentan como el mismo lugar
  const core = s => norm(s)
    .replace(/^(terminal|paradero|av|avenida|jr|jiron|ovalo|mercado|estacion|puente|cruce)\s+/, '')
    .replace(/^(de|del|la|el)\s+/, '');

  const codeByWr = {};
  for (const [rid, c] of Object.entries(map.routes)) {
    const wr = (c.folder || '').match(/route_(\d+)$/)?.[1];
    if (wr) codeByWr[wr] = rid.replace(/-(ida|vuelta)$/i, '').replace(/_\d+$/, '').toUpperCase();
  }

  const lugares = new Map();   // core -> { variantes, rutas }
  const todos = [];            // [{ codigo, extremo }]
  for (const [wr, e] of Object.entries(ext)) {
    const codigo = codeByWr[wr] || wr;
    for (const s of new Set([e.ida?.from, e.ida?.to, e.vuelta?.from, e.vuelta?.to].filter(Boolean))) {
      const k = core(s);
      if (!k) continue;
      if (!lugares.has(k)) lugares.set(k, { variantes: new Map(), rutas: new Set() });
      const v = lugares.get(k);
      v.rutas.add(codigo);
      v.variantes.set(s, (v.variantes.get(s) || 0) + 1);
      todos.push({ codigo, extremo: s });
    }
  }

  const ranking = [...lugares.values()].map(v => ({
    lugar: [...v.variantes].sort((a, b) => b[1] - a[1])[0][0],
    rutas: v.rutas.size,
    variantes: v.variantes.size
  })).sort((a, b) => b.rutas - a.rutas);

  console.log(`Extremos: ${lugares.size} lugares distintos en ${Object.keys(ext).length} rutas de Wikiroutes`);
  console.table(ranking.slice(0, 30));

  // Uso: extremos.buscar('abancay')
  window.extremos = {
    ranking,
    buscar(texto){
      const q = norm(texto);
      const hits = todos.filter(t => norm(t.extremo).includes(q));
      const rutas = [...new Set(hits.map(h => h.codigo))].sort();
      const nombres = [...new Set(hits.map(h => h.extremo))];
      console.log(`"${texto}": ${rutas.length} rutas, ${nombres.length} nombres distintos`);
      console.log('Nombres:', nombres.join(' | '));
      console.log('Rutas:', rutas.join(', '));
      return rutas;
    }
  };
  console.log("Busca un lugar con: extremos.buscar('abancay')");
})();
