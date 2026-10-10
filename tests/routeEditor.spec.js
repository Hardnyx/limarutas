import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const fixture = JSON.parse(await fs.readFile('pipeline/tests/fixtures/authoring_bundle.json','utf8'));
const runId = Date.now().toString(36);
test.beforeEach(async ({ page }) => {
  await page.route('https://unpkg.com/**', route => route.fulfill({ path: path.resolve('node_modules/leaflet/dist', route.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js') }));
  await page.route('https://*.basemaps.cartocdn.com/**', route => route.fulfill({status:204}));
  await page.goto('http://127.0.0.1:8777/editor.html');
  await expect(page.locator('#connection')).toHaveText('Motor conectado');
});

async function openFixture(page, suffix){
  const data = structuredClone(fixture); data.id += suffix + runId;
  await page.locator('#importFile').setInputFiles({ name: 'route.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#routeName')).toHaveText(data.name);
  await expect(page.locator('#connection')).toHaveText('Motor conectado');
  return data;
}

async function clickSegment(page, index){
  // SVG strokes can be visible with a zero-width bounding box on north/south roads.
  const center = await page.locator(`path[data-path-index="${index}"]`).evaluate(el => {
    const box = el.getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2};
  });
  await page.mouse.click(center.x,center.y);
}

test('editor imports, edits, undoes, saves, accepts and exports compatible geometry', async ({ page }, info) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const data=await openFixture(page,`-save-${info.project.name}`);
  if(info.project.name==='beta') await page.screenshot({path:'pipeline/temp/authoring/editor-desktop.png'});
  await page.getByRole('button',{name:'Paraderos',exact:true}).click();
  await page.getByLabel('Nombre del paradero 1',{exact:true}).fill('Inicio corregido');
  await page.getByLabel('Nombre del paradero 1',{exact:true}).press('Tab');
  await expect(page.locator('#editStatus')).toHaveText('Cambios sin guardar');
  await page.getByRole('button',{name:'Deshacer',exact:true}).click();
  await expect(page.getByLabel('Nombre del paradero 1',{exact:true})).toHaveValue('1');
  await page.getByRole('button',{name:'Rehacer',exact:true}).click();
  await expect(page.getByLabel('Nombre del paradero 1',{exact:true})).toHaveValue('Inicio corregido');
  await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();
  await expect(page.locator('#editStatus')).toHaveText('Borrador · revisión 1');
  await page.getByRole('button',{name:'Revisión',exact:true}).click();
  await page.getByRole('button',{name:'Aceptar recorrido validado',exact:true}).click();
  await expect(page.locator('#editStatus')).toHaveText('Recorrido aceptado');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Exportar aprobado',exact:true}).click();
  const artifact=await downloaded;
  const exported=JSON.parse(await fs.readFile(await artifact.path(),'utf8'));
  expect(exported.validation.accepted).toBe(true);
  expect(exported.files['stops_trip1.geojson'].features[0].properties.name).toBe('Inicio corregido');
  expect(exported.files['route_track_trip1.osm.geojson'].features[0].geometry.coordinates).toHaveLength(5);
  expect(exported.files['route_track_trip1.route.json'].source.track).toEqual(data.track);
  expect(errors).toEqual([]);
});

test('reordering stops blocks acceptance and cancellation restores the original', async ({ page }) => {
  await openFixture(page,'-order');
  await page.getByRole('button',{name:'Paraderos',exact:true}).click();
  await page.getByRole('button',{name:'Subir paradero 3',exact:true}).click();
  await page.getByRole('button',{name:'Revisión',exact:true}).click();
  await expect(page.locator('#issueList')).toContainText('Paraderos fuera de orden');
  await expect(page.locator('#acceptRoute')).toBeDisabled();
  await page.getByRole('button',{name:'Cancelar cambios',exact:true}).click();
  await expect(page.locator('#acceptRoute')).toBeEnabled();
});

test('replacing a selected segment preserves the rest of the imported route', async ({ page }) => {
  await openFixture(page,'-segment');
  await page.getByRole('button',{name:'Seleccionar tramo',exact:true}).click();
  await clickSegment(page,1);
  await expect(page.locator('#pathHint')).toContainText('selecciona el final');
  await clickSegment(page,2);
  await page.getByRole('button',{name:'Aplicar recorrido',exact:true}).click();
  await expect(page.locator('#editorMessage')).toContainText('Recorrido actualizado');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Exportar vista previa',exact:true}).click();
  const artifact=await downloaded;
  const exported=JSON.parse(await fs.readFile(await artifact.path(),'utf8'));
  const refs=exported.files['route_track_trip1.route.json'].path;
  expect(refs[0].edge).toBe('1:0'); expect(refs.at(-1).edge).toBe('3:0');
  expect(exported.validation.ready).toBe(true);
});

test('editor controls and map remain usable on a phone', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await openFixture(page,'-mobile');
  await expect(page.locator('#saveDraft')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Paraderos',exact:true}).click();
  await expect(page.getByLabel('Nombre del paradero 1',{exact:true})).toBeVisible();
  await page.screenshot({path:'pipeline/temp/authoring/editor-mobile.png'});
});

test('a new route is built by selecting real street segments and placing stops', async ({ page }, info) => {
  await openFixture(page,'-draw-position');
  await page.getByText('Abrir o crear ruta',{exact:true}).click();
  await page.getByRole('button',{name:'Nueva ruta',exact:true}).click();
  await page.locator('#newId').fill(`draw-${info.project.name}-${runId}`);
  await page.locator('#newName').fill('Recorrido nuevo');
  await page.getByRole('button',{name:'Crear borrador',exact:true}).click();
  await expect(page.locator('#routeName')).toHaveText('Recorrido nuevo');
  for(const edge of ['1:0','3:0']){
    const center=await page.locator(`path[data-edge="${edge}"]`).evaluate(el=>{const b=el.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
    await page.mouse.click(center.x,center.y);
    await expect(page.locator('#connection')).toHaveText('Motor conectado');
  }
  await expect(page.locator('#applyPath')).toBeEnabled();
  await expect(page.locator('#saveDraft')).toBeDisabled();
  await page.getByRole('button',{name:'Aplicar recorrido',exact:true}).click();
  await expect(page.locator('#editorMessage')).toContainText('Recorrido actualizado');
  await page.getByRole('button',{name:'Paraderos',exact:true}).click();
  for(const [name,index] of [['Inicio',0],['Final',3]]){
    await page.locator('#stopName').fill(name);
    await page.getByRole('button',{name:'Ubicar paradero en el mapa',exact:true}).click();
    await clickSegment(page,index);
    await expect(page.locator('#editorMessage')).toContainText('Paradero añadido');
  }
  await page.getByRole('button',{name:'Revisión',exact:true}).click();
  await expect(page.locator('#acceptRoute')).toBeEnabled();
  await expect(page.locator('#reviewSummary')).toContainText('2 paraderos · 0 avisos');
});

test('dragging a stop changes only its edited location and preserves its source',async({page})=>{
  const data=await openFixture(page,'-drag');
  const box=await page.locator('[data-stop-id="1"]').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2+2,{steps:5});
  await page.mouse.up();
  await expect(page.locator('#editStatus')).toHaveText('Cambios sin guardar');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Exportar vista previa',exact:true}).click();
  const exported=JSON.parse(await fs.readFile(await (await downloaded).path(),'utf8'));
  const route=exported.files['route_track_trip1.route.json'];
  expect(route.source.stops).toEqual(data.stops);
  expect(route.stops[0].coordinates).not.toEqual(data.stops.features[0].geometry.coordinates);
});

test('opening the static editor without a service leaves all editing actions disabled',async({page})=>{
  await page.goto('/editor.html');
  await expect(page.locator('#offlineHelp')).toBeVisible();
  await expect(page.locator('#connection')).toHaveText('Motor desconectado');
  await expect(page.locator('#saveDraft')).toBeDisabled();
  await expect(page.locator('#editorMessage')).toContainText('Abre el editor desde el servicio local');
});

test('a refreshed source requires conflict choices and preserves the saved edits until applied',async({page},info)=>{
  const data=await openFixture(page,`-refresh-${info.project.name}`);
  await page.getByRole('button',{name:'Paraderos',exact:true}).click();
  await page.getByLabel('Nombre del paradero 1',{exact:true}).fill('Mi nombre');
  await page.getByLabel('Nombre del paradero 1',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();
  await expect(page.locator('#editStatus')).toContainText('revisión 1');
  await page.getByRole('button',{name:'Revisión',exact:true}).click();
  await page.getByText('Actualizar desde una nueva fuente',{exact:true}).click();
  data.stops.features[0].properties.name='Nombre descargado';
  await page.locator('#sourceUpdateFile').setInputFiles({name:'update.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator('#sourceUpdateSummary')).toContainText('1 conflictos pendientes');
  await expect(page.locator('#applySourceUpdate')).toBeDisabled();
  await expect(page.locator('#saveDraft')).toBeDisabled();
  await page.getByLabel('Resolver stop:1#1.name',{exact:true}).selectOption('local');
  await expect(page.locator('#sourceUpdateSummary')).toContainText('0 conflictos pendientes');
  await page.getByRole('button',{name:'Aplicar actualización',exact:true}).click();
  await expect(page.locator('#editStatus')).toContainText('revisión 2');
  await page.getByRole('button',{name:'Paraderos',exact:true}).click();
  await expect(page.getByLabel('Nombre del paradero 1',{exact:true})).toHaveValue('Mi nombre');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Exportar vista previa',exact:true}).click();
  const exported=JSON.parse(await fs.readFile(await (await downloaded).path(),'utf8'));
  const route=exported.files['route_track_trip1.route.json'];
  expect(route.source.stops.features[0].properties.name).toBe('Nombre descargado');
  expect(route.stops[0].name).toBe('Mi nombre');
  expect(route.review.accepted).toBe(false);
});

test('dragging a route waypoint requests a real carriageway and waits for applying the path',async({page},info)=>{
  await openFixture(page,'-anchor-position');
  await page.getByText('Abrir o crear ruta',{exact:true}).click();
  await page.getByRole('button',{name:'Nueva ruta',exact:true}).click();
  await page.locator('#newId').fill(`anchors-${info.project.name}-${runId}`);
  await page.locator('#newName').fill('Pasos editables');
  await page.getByRole('button',{name:'Crear borrador',exact:true}).click();
  await expect(page.locator('#routeName')).toHaveText('Pasos editables');
  for(const edge of ['1:0','3:0']){
    const center=await page.locator(`path[data-edge="${edge}"]`).evaluate(el=>{const b=el.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
    await page.mouse.click(center.x,center.y);
    await expect(page.locator('#connection')).toHaveText('Motor conectado');
  }
  await page.getByRole('button',{name:'Aplicar recorrido',exact:true}).click();
  await expect(page.locator('#editorMessage')).toContainText('Recorrido actualizado');
  const box=await page.locator('[data-anchor-index="0"]').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2+2,{steps:5});
  await page.mouse.up();
  await expect(page.locator('.leaflet-popup')).toContainText('Selecciona la calzada');
  await page.locator('.leaflet-popup button').filter({hasText:'1:0'}).click();
  await expect(page.locator('#editStatus')).toHaveText('Recorrido pendiente de aplicar');
  await expect(page.locator('#saveDraft')).toBeDisabled();
  await page.getByRole('button',{name:'Aplicar recorrido',exact:true}).click();
  await expect(page.locator('#editorMessage')).toContainText('Recorrido actualizado');
  await expect(page.locator('#saveDraft')).toBeEnabled();
});
