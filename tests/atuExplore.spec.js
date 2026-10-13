import { test, expect } from './fixtures.js';

test('Explorar preserves official multipart projects and never registers them as operating routes', async ({ app, page }) => {
  await page.click('#tabExplore');
  await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  await expect(page.locator('#explorePane')).toBeVisible();
  await expect(page.locator('#panels')).not.toBeVisible();
  await expect(page.locator('#explorePanels > section.panel')).toHaveCount(4);
  await page.locator('#explorePanels > section[data-mode="metro"] > .panel-head').click();
  const result=await page.evaluate(async()=>{
    const {state}=await import('/assets/js/config.js');
    const red=await (await fetch('/data/processed/planificado/red.geojson')).json();
    const split=red.features.find(f=>f.properties.modo==='metro' && f.geometry.coordinates.length>1);
    document.querySelector(`[data-id="${split.id}"] input`).click();
    const lines=[];state.map.eachLayer(layer=>{if(layer.options?.pane==='projectLine' && layer.getLatLngs)lines.push(layer);});
    const line=lines.at(-1);
    const actual=line.getLatLngs().map(part=>part.map(p=>[p.lng,p.lat]));
    const ids=Object.values(state.systems).flatMap(s=>(s.services||[]).map(r=>r.id));
    return {parts:actual.length,exact:JSON.stringify(actual)===JSON.stringify(split.geometry.coordinates.map(part=>part.map(p=>p.slice(0,2)))),dash:line.options.dashArray,smooth:line.options.smoothFactor,color:line.options.color,contaminated:ids.some(id=>id.startsWith('pmu:'))};
  });
  expect(result.parts).toBeGreaterThan(1);expect(result.exact).toBe(true);
  expect(result.dash).toBe('8 6');expect(result.smooth).toBe(0);expect(result.contaminated).toBe(false);
  expect(result.color).toBe('#f8ed29');
  await expect(page.locator('.project-row:visible')).toHaveCount(12);
  await page.locator('.project-row:visible .project-name').first().click();
  await expect(page.locator('.project-info')).toContainText('Fuente ATU');
  await page.screenshot({path:'pipeline/temp/authoring/explore-desktop.png'});
  await page.getByRole('tab',{name:'Rutas',exact:true}).click();
  await expect(page.locator('#explorePane')).not.toBeVisible();
  await expect(page.locator('#panels')).toBeVisible();
});

test('Explorar shares route panels, colored rows and filtered group selection',async({app,page})=>{
  await page.click('#tabExplore');
  await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  const metro=page.locator('#explorePanels > section[data-mode="metro"]');
  await metro.locator('.panel-head').click();
  await expect(metro.locator('.item-head')).toHaveCount(12);
  const all=metro.locator('.panel-head > input');
  await all.check();
  await expect(metro.locator('.item-head input:checked')).toHaveCount(12);
  const first=metro.locator('.item-head input').first();
  await first.uncheck();
  expect(await all.evaluate(c=>c.indeterminate)).toBe(true);
  const swatches=await metro.locator('.item-head .tag').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));
  expect(new Set(swatches).size).toBeGreaterThan(6);
  await page.locator('#explorePane input[type=search]').fill('Línea 3');
  await expect(page.locator('.project-row:visible')).toHaveCount(1);
  await all.uncheck();
  await expect(page.locator('.project-row:visible .item-head input')).not.toBeChecked();
  await page.locator('#explorePane input[type=search]').fill('');
  await expect(metro.locator('.item-head input:checked')).toHaveCount(10);
  await page.getByRole('button',{name:'Quitar proyectos del mapa',exact:true}).click();
  await expect(metro.locator('.item-head input:checked')).toHaveCount(0);
  expect(await all.evaluate(c=>c.indeterminate)).toBe(false);
});

test('Explorar remains usable on mobile and in the dark theme',async({app,page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.click('#tabExplore');
  await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  await page.locator('#explorePane input[type=search]').fill('Línea 3');
  await expect(page.locator('.project-row:visible')).toHaveCount(1);
  await page.locator('.project-row:visible .project-name').click();
  await expect(page.locator('#projectDetails')).toContainText('Huandoy');
  await expect(page.locator('#projectDetails')).toContainText('Ubicación pendiente de verificación');
  await expect(page.locator('#projectDetails ol[data-point-type="estacion"] li')).toHaveCount(28);
  await page.evaluate(()=>window.LimaRutasTheme.set('dark'));
  await page.screenshot({path:'pipeline/temp/authoring/explore-mobile-dark.png'});
  const width=await page.evaluate(()=>document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test('Planned points use evidence links, independent toggles and their own pane',async({app,page})=>{
  await page.click('#tabExplore');
  await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  await page.locator('#explorePane input[type=search]').fill('Línea 3');
  await page.locator('.project-row:visible .project-name').click();
  await expect(page.locator('#explorePointCount')).toHaveText('2 puntos visibles · 26 ubicaciones pendientes');
  const stationList=page.locator('#projectDetails ol[data-point-type="estacion"]');
  await expect(stationList.getByRole('button')).toHaveCount(2);
  await page.locator('.project-point-controls input[data-point-type="centro_transferencia"]').check();
  await expect(page.locator('#explorePointCount')).toHaveText('5 puntos visibles · 27 ubicaciones pendientes');
  const result=await page.evaluate(async()=>{
    const {state}=await import('/assets/js/config.js');
    const markers=[];state.map.eachLayer(l=>{if(l.options?.pane==='projectPoints' && l.getLatLng) markers.push(l);});
    const graph=await(await fetch('/pipeline/output/trip_graph.json')).json();
    return {markers:markers.length,contaminated:Object.keys(graph.routes).some(k=>k.startsWith('planificado:'))};
  });
  expect(result.markers).toBe(5);expect(result.contaminated).toBe(false);
  await stationList.getByRole('button',{name:'Conde de San Isidro'}).click();
  await expect(page.locator('.leaflet-projectPoints-pane .leaflet-popup')).toContainText('2022-07');
  await page.getByRole('tab',{name:'Rutas',exact:true}).click();
  await expect(page.locator('.leaflet-projectPoints-pane')).not.toBeVisible();
});
