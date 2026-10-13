import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStops} from '../pipeline/scripts/wikiroutes/wr_live_stops.mjs';
import {observeRenderedMarkers} from '../pipeline/scripts/wikiroutes/wr_rendered_markers.mjs';
test('public marker lifecycle captures private MapLibre 6 collections and discards removed trips',()=>{
 globalThis.window={};observeRenderedMarkers();
 class Marker{
  addTo(map){this.remove();this.map=map;return this;}
  remove(){this.map=null;return this;}
 }
 window.maplibregl={Marker};const a={},b={},m=new Marker();
 assert.equal(m.addTo(a),m);assert.deepEqual(window.__limaRenderedMarkers(a),[m]);
 m.addTo(b);assert.deepEqual(window.__limaRenderedMarkers(a),[]);assert.deepEqual(window.__limaRenderedMarkers(b),[m]);
 assert.equal(m.remove(),m);assert.deepEqual(window.__limaRenderedMarkers(b),[]);
 delete globalThis.window;
});
test('marker order and extra points do not change named stop identity',()=>{
 const r=resolveStops([{id:'1',name:'A'},{id:'2',name:'B'}],[{id:'extra',coordinates:[0,0]},{id:'2',coordinates:[2,2]},{id:'1',coordinates:[1,1]}]);
 assert.equal(r.status,'located');assert.deepEqual(r.stops.map(s=>s.coordinates),[[1,1],[2,2]]);
});
test('missing or conflicting coordinates stay unknown',()=>{
 const r=resolveStops([{id:'1',name:'A'},{id:'2',name:'B'}],[{id:'1',coordinates:[1,1]},{id:'1',coordinates:[1,2]}]);
 assert.equal(r.status,'coordinates_unavailable');assert.deepEqual(r.stops.map(s=>s.coordinates),[null,null]);
});
