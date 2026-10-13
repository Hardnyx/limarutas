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
  expect(result.dash).toBeNull();expect(result.smooth).toBe(0);expect(result.contaminated).toBe(false);
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
  await expect(page.locator('#explorePointCount')).toHaveText('4 puntos visibles · 24 ubicaciones pendientes');
  const stationList=page.locator('#projectDetails ol[data-point-type="estacion"]');
  await expect(stationList.getByRole('button')).toHaveCount(4);
  await page.locator('.project-options > summary').click();
  await page.locator('.project-point-controls input[data-point-type="centro_transferencia"]').check();
  await expect(page.locator('#explorePointCount')).toHaveText('7 puntos visibles · 25 ubicaciones pendientes');
  const result=await page.evaluate(async()=>{
    const {state}=await import('/assets/js/config.js');
    const markers=[];state.map.eachLayer(l=>{if(l.options?.pane==='projectPoints' && l.getLatLng) markers.push(l);});
    const graph=await(await fetch('/pipeline/output/trip_graph.json')).json();
    return {markers:markers.length,contaminated:Object.keys(graph.routes).some(k=>k.startsWith('planificado:'))};
  });
  expect(result.markers).toBe(7);expect(result.contaminated).toBe(false);
  await stationList.getByRole('button',{name:'Conde de San Isidro'}).click();
  await expect(page.locator('.leaflet-projectPoints-pane .leaflet-popup')).toContainText('2022-07');
  await page.getByRole('tab',{name:'Rutas',exact:true}).click();
  await expect(page.locator('.leaflet-projectPoints-pane')).not.toBeVisible();
});


test('project selection matches route controls and corridor hierarchy',async({app,page})=>{
  await page.click('#tabExplore');await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  const all=page.locator('#exploreToggleAll');
  await page.locator('#explorePane input[type=search]').fill('Línea 3');
  await all.click();await expect(all).toHaveText('Desmarcar todo');
  await expect(page.locator('#exploreOnMapCount')).toHaveText('1');
  await page.locator('.project-row:visible .project-name').click();
  await expect(page.locator('#projectDetails .project-track-preview')).toBeVisible();
  await expect(page.locator('#projectDetails .project-station-diagram li')).toHaveCount(28);
  await page.locator('#explorePane input[type=search]').fill('');
  const corridor=page.locator('#explorePanels > [data-mode=corredor]');
  await corridor.locator(':scope > .panel-head').click();
  const red=corridor.locator('[data-corridor=rojo]');
  await red.locator(':scope > .panel-head').click();
  await expect(red.locator('.project-row')).toBeVisible();
  await red.locator(':scope > .panel-head > input').check();
  await expect(page.locator('#exploreOnMapCount')).toHaveText('2');
  const color=await page.evaluate(async()=>{const {state}=await import('/assets/js/config.js');let color;state.map.eachLayer(l=>{if(l.options?.pane==='projectLine' && l.feature?.properties.display_corridor?.corridor==='rojo') color=l.options.color;});return color;});
  expect(color).toBe('#e4002b');
  await page.locator('#exploreClear').click();await expect(page.locator('#exploreOnMap')).toBeHidden();
  await expect(red.locator('.item-head input')).not.toBeChecked();
});

test('CETRAM display uses the linked physical intersection and keeps source evidence',async({app,page})=>{
  await page.click('#tabExplore');await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  await page.locator('.project-options > summary').click();
  await page.locator('.project-point-controls input[data-point-type=centro_transferencia]').check();
  const result=await page.evaluate(async()=>{
    const {state}=await import('/assets/js/config.js');const catalog=await(await fetch('/data/processed/planificado/estaciones_catalogo.json')).json();
    const r=catalog.records.find(r=>r.id==='planificado:centro_transferencia:gamarra');let actual;
    state.map.eachLayer(l=>{if(l.options?.title==='Gamarra'){const p=l.getLatLng();actual=[p.lng,p.lat];}});
    return {actual,display:r.display_geometry.coordinates,source:r.source_geometry.coordinates,displacement:r.display_adjustment.displacement_m};
  });
  expect(result.actual).toEqual(result.display);expect(result.source).not.toEqual(result.display);expect(result.displacement).toBeGreaterThan(50);
});

test('Explorar and Rutas use the same search and section styles',async({app,page})=>{
  test.skip(!await page.locator('html.beta').count(),'The legacy layout keeps its search in the top bar.');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.LimaRutasTheme.set('dark'));
  const styles=async selector=>page.locator(selector).first().evaluate(node=>{
    const s=getComputedStyle(node);return Object.fromEntries(['height','fontSize','borderRadius','backgroundColor','color','padding','border'].map(k=>[k,s[k]]));
  });
  const search=await styles('#searchInput'),head=await styles('#panels > .panel > .panel-head');
  await page.screenshot({path:'pipeline/temp/authoring/routes-identity.png'});
  await page.click('#tabExplore');await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  expect(await styles('#explorePane .route-search-input')).toEqual(search);
  expect(await styles('#explorePanels > .panel > .panel-head')).toEqual(head);
  await expect(page.locator('#explorePane > h2')).toHaveCSS('clip','rect(0px, 0px, 0px, 0px)');
  await page.screenshot({path:'pipeline/temp/authoring/explore-identity.png'});
});

test('L1 and operating L2 stations remain in the planning view with solid traces',async({app,page})=>{
  await page.click('#tabExplore');await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  await page.locator('#explorePane input[type=search]').fill('Línea 1 Villa');
  await page.locator('.project-row:visible .project-name').click();
  await expect(page.locator('#projectDetails ol[data-point-type=estacion] li')).toHaveCount(26);
  await expect(page.locator('#projectDetails')).toContainText('Bayóvar');
  const result=await page.evaluate(async()=>{
    const {state}=await import('/assets/js/config.js');const points=[],lines=[];
    state.map.eachLayer(l=>{if(l.options?.pane==='projectPoints' && l.getLatLng)points.push(l.getTooltip()?.getContent());if(l.options?.pane==='projectLine' && l.getLatLngs)lines.push(l.options.dashArray);});
    return {points,lines};
  });
  expect(result.points).toHaveLength(26);expect(result.points.every(t=>!t.includes('Proyectado'))).toBe(true);
  expect(result.lines.every(d=>!d)).toBe(true);
  await page.locator('#explorePane input[type=search]').fill('Línea 2');
  await page.locator('.project-row:visible[data-horizon="5"] .project-name').click();
  await expect(page.locator('#projectDetails ol[data-point-type=estacion] li')).toHaveCount(27);
  await expect(page.locator('#projectDetails')).toContainText('Hermilio Valdizán');
});

test('corridor colors segment shared stretches without changing the ATU source',async({app,page})=>{
  await page.click('#tabExplore');await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  await page.locator('#explorePane input[type=search]').fill('Alameda Del Corregidor');
  await page.locator('.project-row:visible .project-name').click();
  const result=await page.evaluate(async()=>{
    const {state}=await import('/assets/js/config.js');const colors=[];
    state.map.eachLayer(l=>{if(l.options?.pane==='projectLine' && l.getLatLngs)colors.push(l.options.color);});
    const source=await(await fetch('/data/processed/planificado/red.geojson')).json();
    return {colors,original:source.features.find(f=>f.properties.nombre.includes('Alameda Del Corregidor')).properties.color};
  });
  expect(result.colors).toContain('#e4002b');expect(result.colors).toContain('#dc6100');expect(result.original).toBe('#dc6100');
});
