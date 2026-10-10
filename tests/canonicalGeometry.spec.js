import { test, expect } from './fixtures.js';

test('canonical tracks retain all shared curve vertices while legacy rendering stays unchanged',async({app,page})=>{
  const coordinates=[[-77.04,-12.05],[-77.0399,-12.05003],[-77.0398,-12.05002],[-77.0397,-12.05]];
  for(const kind of ['canonical','legacy']){
    await page.route(`**/fixture-${kind}/**`,route=>route.fulfill({json:{type:'FeatureCollection',features:route.request().url().includes('stops')?[]:[{type:'Feature',properties:kind==='canonical'?{authoring:{accepted:true}}:{},geometry:{type:'LineString',coordinates}}]}}));
  }
  const actual=await page.evaluate(async()=>{
    const {buildWikiroutesLayer}=await import('/assets/js/parsers.js');
    const {state}=await import('/assets/js/config.js');
    const result={};
    for(const kind of ['canonical','legacy']){
      await buildWikiroutesLayer(kind,`/fixture-${kind}`,{trip:1});
      const paths=[];
      state.systems.wr.layers.get(kind).eachLayer(l=>l.eachLayer?.(p=>{if(p.feature?.geometry.type==='LineString') paths.push({smoothFactor:p.options.smoothFactor,coordinates:p.feature.geometry.coordinates});}));
      result[kind]=paths;
    }
    return result;
  });
  expect(actual.canonical[0]).toEqual({smoothFactor:0,coordinates});
  expect(actual.legacy[0].smoothFactor).toBe(1);
});
