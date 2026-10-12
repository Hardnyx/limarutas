import { test, expect } from './fixtures.js';

test('all six AeroDirecto directions render the accepted directed OSM geometry exactly',async({app,page})=>{
  const result=await page.evaluate(async()=>{
    const {state}=await import('/assets/js/config.js');
    const {buildWikiroutesLayer}=await import('/assets/js/parsers.js');
    const definitions=await (await fetch('/pipeline/output/wr_map.json')).json();
    const checked=[];
    for(const [key,def] of Object.entries(definitions.routes).filter(([id])=>id.startsWith('AD-'))){
      await buildWikiroutesLayer(key,def.folder,{color:'#3388ff',trip:def.trip,osm:true});
      const expected=await (await fetch(`/${def.folder}/route_track_trip${def.trip}.osm.geojson`)).json();
      const coords=[];let smooth;
      const visit=layer=>{if(layer.getLatLngs){coords.push(...layer.getLatLngs().map(p=>[p.lng,p.lat]));smooth=layer.options.smoothFactor;}else layer.eachLayer?.(visit);};
      state.systems.wr.layers.get(key).eachLayer(visit);
      checked.push({key,exact:JSON.stringify(coords)===JSON.stringify(expected.features[0].geometry.coordinates),smooth,accepted:expected.features[0].properties.authoring.accepted});
    }
    return checked;
  });
  expect(result).toHaveLength(6);
  for(const r of result){expect(r.exact,r.key).toBe(true);expect(r.smooth,r.key).toBe(0);expect(r.accepted).toBe(true);}
});
