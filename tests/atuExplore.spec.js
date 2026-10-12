import { test, expect } from './fixtures.js';

test('Explorar preserves official multipart projects and never registers them as operating routes', async ({ app, page }) => {
  await page.click('#tabExplore');
  await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  await expect(page.locator('#explorePane')).toBeVisible();
  await expect(page.locator('#panels')).not.toBeVisible();
  const result=await page.evaluate(async()=>{
    const {state}=await import('/assets/js/config.js');
    const red=await (await fetch('/data/processed/planificado/red.geojson')).json();
    const split=red.features.find(f=>f.properties.modo==='metro' && f.geometry.coordinates.length>1);
    document.querySelector(`[data-id="${split.id}"] input`).click();
    const lines=[];state.map.eachLayer(layer=>{if(layer.options?.pane==='projectLine' && layer.getLatLngs)lines.push(layer);});
    const line=lines.at(-1);
    const actual=line.getLatLngs().map(part=>part.map(p=>[p.lng,p.lat]));
    const ids=Object.values(state.systems).flatMap(s=>(s.services||[]).map(r=>r.id));
    return {parts:actual.length,exact:JSON.stringify(actual)===JSON.stringify(split.geometry.coordinates.map(part=>part.map(p=>p.slice(0,2)))),dash:line.options.dashArray,smooth:line.options.smoothFactor,contaminated:ids.some(id=>id.startsWith('pmu:'))};
  });
  expect(result.parts).toBeGreaterThan(1);expect(result.exact).toBe(true);
  expect(result.dash).toBe('8 6');expect(result.smooth).toBe(0);expect(result.contaminated).toBe(false);
  await page.selectOption('#explorePane select[aria-label="Tecnología del proyecto"]','metro');
  await expect(page.locator('.project-row:visible')).toHaveCount(12);
  await page.locator('.project-row:visible .project-name').first().click();
  await expect(page.locator('.project-info')).toContainText('Fuente ATU');
  await page.screenshot({path:'pipeline/temp/authoring/explore-desktop.png'});
  await page.getByRole('tab',{name:'Rutas',exact:true}).click();
  await expect(page.locator('#explorePane')).not.toBeVisible();
  await expect(page.locator('#panels')).toBeVisible();
});

test('Explorar remains usable on mobile and in the dark theme',async({app,page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.click('#tabExplore');
  await expect(page.locator('#exploreCount')).toHaveText('106 de 106 trazados');
  await page.locator('#explorePane input[type=search]').fill('Línea 3');
  await expect(page.locator('.project-row:visible')).toHaveCount(1);
  await page.locator('.project-row:visible .project-name').click();
  await expect(page.locator('#projectDetails')).toContainText('Huandoy');
  await expect(page.locator('#projectDetails')).toContainText('ubicación pendiente de verificación');
  await expect(page.locator('#projectDetails ol li')).toHaveCount(28);
  await page.evaluate(()=>window.LimaRutasTheme.set('dark'));
  await page.screenshot({path:'pipeline/temp/authoring/explore-mobile-dark.png'});
  const width=await page.evaluate(()=>document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
