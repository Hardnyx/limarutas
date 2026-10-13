// Inspect the normally rendered map. No replay of route tokens or decoding of protected responses.
import {chromium} from '@playwright/test';
import readline from 'node:readline';
const args=['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const browser=await chromium.launch({headless:process.env.WR_VISIBLE!=='1',args,
  ...(process.env.WR_BROWSER_EXECUTABLE?{executablePath:process.env.WR_BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();page.setDefaultTimeout(20000);
const read=async()=>page.evaluate(()=>{
  const map=window.__wrRouteMap;
  if(map){
    const source=map.getSource('wr-route');const feature=source?.serialize()?.data;
    if(feature?.geometry?.coordinates?.length>1){
      const markers=(map._markers||[]).filter(m=>m._wrStop);
      const stops=markers.map((m,i)=>{const p=m.getLngLat(),s=m._wrStop;return {id:String(s.id??s.stopId??''),name:s.name,sequence:i+1,coordinates:[p.lng,p.lat]};});
      const color=getComputedStyle(document.querySelector('.legend-color')).backgroundColor;
      return {engine:'maplibre',geometry:{type:'FeatureCollection',features:[feature]},color,stops};
    }
  }
  // Keep support for older Leaflet pages and preserve every component.
  if(window.L){
    let result;
    for(const value of Object.values(window)){
      if(!value || typeof value.eachLayer!=='function' || typeof value.getCenter!=='function')continue;
      const features=[];let color;
      value.eachLayer(l=>{if(l instanceof L.Polyline && !(l instanceof L.Polygon)){const f=l.toGeoJSON();if(f.geometry?.coordinates?.length){features.push(f);color=l.options.color||l.options.strokeColor;}}});
      if(features.length)result={engine:'leaflet',geometry:{type:'FeatureCollection',features},color,stops:null};
    }
    if(result)return result;
  }
  return null;
});
const collect=async url=>{
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  if(!response || response.status()>=400)throw Error('HTTP '+response?.status());
  const text=await page.locator('body').innerText();
  if(/verify you are human|checking your browser|automated traffic|just a moment|access denied/i.test(text))throw Error('SITE_BLOCK');
  const title=await page.locator('h1').first().innerText();
  const show=page.getByRole('button',{name:'Mostrar mapa',exact:true});
  if(await show.count())await show.click();
  await page.waitForFunction(()=>window.__wrRouteMap?.getSource('wr-route') || (window.L && document.querySelector('.leaflet-pane')),null,{timeout:20000}).catch(async()=>{
    const body=await page.locator('body').innerText();
    if(/WebGL|aceleración por hardware/i.test(body))throw Error('WEBGL_UNAVAILABLE');
    throw Error('MAP_UNAVAILABLE');
  });
  const headings=await page.locator('.route-direction').evaluateAll(nodes=>nodes.map(n=>({name:n.querySelector('h2')?.textContent?.trim(),stops:[...n.querySelectorAll('a[href*="/stops/"]')].map(a=>({id:a.getAttribute('href').match(/stops\/(\d+)/)?.[1],name:a.textContent.trim()}))})));
  let toggles=await page.locator('#routeDropDown .scroll-content [trip-seq]').evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute('trip-seq'))));
  if(!toggles.length)toggles=await page.locator('[data-tab-toggle^="trip"]').evaluateAll(nodes=>nodes.map((n,i)=>Number(n.getAttribute('trip-seq'))||i+1));
  toggles=[...new Set(toggles)].sort((a,b)=>a-b);if(!toggles.length)toggles=[1];
  const trips=[];
  for(const trip of toggles){
    if(toggles.length>1){
      const selected=page.locator('#routeDropDown .item-selected');
      if(await selected.count())await selected.click();
      const option=page.locator(`#routeDropDown .scroll-content [trip-seq="${trip}"]`);
      if(await option.count())await option.click();
      else await page.locator(`[data-tab-toggle="trip${trip}"]`).click();
    }
    await page.waitForFunction(()=>{const s=window.__wrRouteMap?.getSource('wr-route');return !s || s.serialize()?.data?.geometry?.coordinates?.length>1;});
    const data=await read();if(!data)throw Error('EMPTY_GEOMETRY');
    const names=headings[trip-1]?.stops||[];
    if(data.stops && names.length!==data.stops.length)throw Error('STOP_COUNT_MISMATCH');
    if(data.stops)for(let i=0;i<names.length;i++){data.stops[i].id=names[i].id;data.stops[i].name=names[i].name;}
    trips.push({trip,name:headings[trip-1]?.name,...data,stops_status:data.stops?'located':'unavailable'});
  }
  return {title,url:page.url(),trips};
};
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of input){
  let response;
  try{const request=JSON.parse(line);if(request.close)break;response={ok:true,data:await collect(request.url)};}
  catch(error){response={ok:false,error:String(error.message).slice(0,500)};}
  process.stdout.write(JSON.stringify(response)+'\n');
}
await browser.close();
