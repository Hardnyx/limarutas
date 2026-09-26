// tests/explore.spec.js
// Prueba exploratoria basada en modelo: secuencias aleatorias (pero
// reproducibles por semilla) de todo lo que puede hacer el usuario, en
// cualquier orden. Después de cada paso se verifica que lo que se ve sea
// coherente con lo que el usuario cree que hizo (ver docs/DECISION_MAP.md).
//
//   SEEDS=1,2,3 STEPS=60 npx playwright test tests/explore.spec.js
import { test, expect } from './fixtures.js';

const SEEDS = (process.env.SEEDS || '11,23,37').split(',').map(Number);
const STEPS = Number(process.env.STEPS || 35);

// PRNG reproducible (mulberry32)
function rng(seed){
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Invariantes: lo que se ve debe corresponder con las casillas
async function checkInvariants(page){
  return page.evaluate(async () => {
    const { state } = await import('/assets/js/config.js');
    const errs = [];
    const LEAF = '#panels .item .item-head input[type="checkbox"]';

    // 1) Casillas de grupo coherentes con sus hojas
    document.querySelectorAll('#panels .panel-head > input[type="checkbox"]').forEach(g => {
      const leaves = [...g.closest('.panel').querySelectorAll('.item .item-head input')]
        .filter(c => !c.closest('.is-color-filtered, .is-text-filtered'));
      if (!leaves.length) return;
      const n = leaves.filter(c => c.checked).length;
      const want = n === 0 ? 'off' : n === leaves.length ? 'on' : 'mixed';
      const got = g.indeterminate ? 'mixed' : g.checked ? 'on' : 'off';
      if (want !== got) errs.push(`grupo ${g.id || g.dataset.group}: ${got}, debería ${want}`);
    });

    // 2) Capas Wikiroutes: visibles exactamente las que piden las hojas marcadas
    const wanted = new Set();
    document.querySelectorAll(LEAF).forEach(c => {
      if (!c.checked) return;
      const { system, id, ida, vuelta, layer, sel } = c.dataset;
      if (ida && vuelta) wanted.add(sel === 'vuelta' ? vuelta : ida);
      else if (layer) wanted.add(layer);
      else if (system === 'corr' && /^\d+$/.test(id)) wanted.add(id);
    });
    const visible = new Set();
    state.systems.wr.layers.forEach((g, id) => { if (state.map.hasLayer(g)) visible.add(id); });
    const loaded = new Set(state.systems.wr.layers.keys());
    for (const id of wanted) if (loaded.has(id) && !visible.has(id)) errs.push(`ruta ${id} marcada pero no dibujada`);
    for (const id of visible) if (!wanted.has(id)) errs.push(`ruta ${id} dibujada sin estar marcada`);

    // 3) Servicios (Metropolitano, Alimentadores, Corredores, Metro)
    for (const sys of ['met', 'alim', 'corr', 'metro']){
      state.systems[sys].lineLayers?.forEach((g, id) => {
        const leaf = document.querySelector(`${LEAF}[data-system="${sys}"][data-id="${CSS.escape(String(id))}"]`);
        const drawn = g.getLayers().length > 0;
        if (drawn && leaf && !leaf.checked) errs.push(`${sys} ${id} dibujado sin estar marcado`);
      });
    }

    // 4) Paraderos: solo con "Mostrar paradas" y de rutas visibles
    const chkStops = document.getElementById('chkStops');
    if (chkStops.checked !== state.showStops) errs.push('casilla "Mostrar paradas" no coincide con el estado');
    state.systems.wr.stopLayers?.forEach((g, id) => {
      const on = state.map.hasLayer(g);
      if (on && !state.showStops) errs.push(`paraderos de ${id} visibles con "Mostrar paradas" apagado`);
      if (on && !visible.has(id)) errs.push(`paraderos de ${id} visibles sin su ruta`);
    });

    // 5) Rutas recientes reflejan la casilla original
    document.querySelectorAll('#p-recent-list .recent-item').forEach(row => {
      const tag = row.querySelector('.recent-row .tag')?.textContent?.trim();
      const chk = row.querySelector('.recent-row input');
      const leaf = row.__leaf;
      if (leaf && chk.checked !== leaf.checked) errs.push(`reciente ${tag}: casilla no coincide`);
      const a = row.querySelector('.dir-mini .segbtn-mini.active')?.dataset.dir;
      const b = leaf?.closest('.item')?.querySelector('.dir-mini .segbtn-mini.active')?.dataset.dir;
      if (a !== b) errs.push(`reciente ${tag}: sentido ${a} ≠ ${b}`);
    });

    // 6) Diálogo: nunca dos a la vez
    if (document.querySelectorAll('.ui-dialog').length > 1) errs.push('dos diálogos abiertos');
    return errs;
  });
}

// Espera a que no queden capas cargándose
async function idle(page){
  await page.waitForFunction(async () => {
    const { state } = await import('/assets/js/config.js');
    return !(state.systems.wr._buildPromises?.size);
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(150);
}

const CODES = ['1240', '1255', '1001', '1203', '301', 'AD-N', 'SE-02', 'IO32B', 'L1', 'A', '1507'];
const STOP_QUERIES = ['puente nuevo', 'acho', 'separadora industrial', 'santa rosa'];

function actions(page, r){
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const clickRandom = async (sel, label) => {
    const n = await page.locator(sel).count();
    if (!n) return `${label}: no hay`;
    const i = Math.floor(r() * n);
    await page.evaluate(([s, k]) => document.querySelectorAll(s)[k].click(), [sel, i]);
    return `${label} #${i}`;
  };
  return [
    [5, 'marcar/desmarcar una ruta', () => clickRandom('#panels .item .item-head input[type="checkbox"]', 'ruta')],
    [2, 'casilla de grupo', () => clickRandom('#panels .panel-head > input[type="checkbox"]', 'grupo')],
    [3, 'cambiar sentido', () => clickRandom('#panels .item .dir-mini .segbtn-mini:not(.active)', 'sentido')],
    // En la nueva interfaz "Limpiar" solo se ve con rutas en el mapa
    [1, 'Desmarcar todo', async () => { await page.evaluate(() => document.getElementById('btnClearAll').click()); return 'Desmarcar todo'; }],
    [3, 'buscar ruta', async () => {
      const q = pick(CODES);
      await page.fill('#searchInput', q);
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter');
      return `buscar ${q}`;
    }],
    [2, 'buscar paradero', async () => {
      const q = pick(STOP_QUERIES);
      await page.fill('#searchInput', q);
      await page.waitForTimeout(300);
      const n = await page.locator('.suggest-item').count();
      if (!n) return `buscar ${q}: sin resultados`;
      const i = Math.floor(r() * Math.min(n, 4));
      await page.locator('.suggest-item').nth(i).click();
      return `buscar ${q} → resultado ${i}`;
    }],
    [2, 'Mostrar paradas', async () => { await page.evaluate(() => document.getElementById('chkStops').click()); return 'Mostrar paradas'; }],
    [1, 'filtro de color', async () => {
      const m = pick(['all', 'real', 'default', 'all']);
      await page.evaluate(k => document.querySelector(`#wrColorFilter [data-mode="${k}"]`).click(), m);
      return `filtro ${m}`;
    }],
    // Solo en la nueva interfaz (Transporte público y Rutas antiguas)
    [1, 'filtro de lista', async () => {
      const n = await page.locator('.list-filter').count();
      if (!n) return 'filtro de lista: no hay';
      const q = pick(['', '', '12', 'vipusa', 'ate', 'san', 'zzz']);
      await page.locator('.list-filter').nth(Math.floor(r() * n)).evaluate((inp, v) => {
        inp.value = v;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }, q);
      await page.waitForTimeout(250);
      return `filtro de lista "${q}"`;
    }],
    [2, 'recientes: casilla', () => clickRandom('#p-recent-list .recent-row input', 'reciente casilla')],
    [2, 'recientes: sentido', () => clickRandom('#p-recent-list .dir-mini .segbtn-mini:not(.active)', 'reciente sentido')],
    [1, 'recientes: quitar', () => clickRandom('#p-recent-list .recent-remove', 'reciente quitar')],
    [1, 'panel: Mostrar las N', () => clickRandom('.route-inspector:not([hidden]) .ri-hint .btn', 'mostrar todas')],
    [1, 'panel: Ver solo esta', async () => {
      const chips = page.locator('.route-inspector:not([hidden]) .ri-chip');
      if (!(await chips.count())) return 'panel: sin chips';
      await chips.nth(Math.floor(r() * await chips.count())).click();
      const b = page.locator('.ri-actions .btn', { hasText: pick(['Ver solo esta', 'Agregar a recientes', 'Mostrar', 'Ocultar']) });
      if (await b.count()) { await b.first().click(); return 'panel: acción'; }
      return 'panel: chip';
    }],
    [2, 'clic en el mapa', async () => {
      const box = await page.locator('#map').boundingBox();
      await page.mouse.click(box.x + 500 + r() * 900, box.y + 100 + r() * 700);
      return 'clic mapa';
    }],
    [1, 'Esc', async () => { await page.keyboard.press('Escape'); return 'Esc'; }],
    [1, 'zoom/mover', async () => {
      await page.evaluate(async ([a, b, z]) => { const { state } = await import('/assets/js/config.js'); state.map.setView([a, b], z, { animate: false }); },
        [-12.05 + (r() - 0.5) * 0.3, -77.02 + (r() - 0.5) * 0.3, 11 + Math.floor(r() * 6)]);
      return 'zoom/mover';
    }]
  ];
}

for (const seed of SEEDS){
  test(`secuencia aleatoria (semilla ${seed}, ${STEPS} pasos)`, async ({ app, page }) => {
    test.setTimeout(STEPS * 12_000 + 60_000);
    const r = rng(seed);
    const acts = actions(page, r);
    const total = acts.reduce((s, [w]) => s + w, 0);
    const history = [];

    for (let step = 1; step <= STEPS; step++){
      let x = r() * total;
      const [, , run] = acts.find(([w]) => (x -= w) < 0);
      history.push(await run());

      // Si aparece el diálogo de muchas rutas, responder como lo haría alguien
      const dlg = page.locator('.ui-dialog');
      if (await dlg.count()){
        const opts = await dlg.locator('.ui-dialog-btn').allTextContents();
        const choice = opts[Math.floor(r() * opts.length)];
        await dlg.locator('.ui-dialog-btn', { hasText: choice }).click();
        history.push(`  diálogo → ${choice}`);
      }
      await idle(page);
      const errs = await checkInvariants(page);
      expect(errs, `paso ${step}:\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}`).toEqual([]);
    }
  });
}
