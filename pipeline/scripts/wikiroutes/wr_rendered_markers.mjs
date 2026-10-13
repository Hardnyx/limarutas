// Observe public Marker lifecycle methods after the site's normal rendering.
// MapLibre 6 keeps its marker collection private; no source responses are read.
export function observeRenderedMarkers(){
  const collections=new WeakMap(),owners=new WeakMap();
  window.__limaRenderedMarkers=map=>[...(collections.get(map)||[])];
  let library;
  Object.defineProperty(window,'maplibregl',{configurable:true,enumerable:true,
    get:()=>library,
    set:value=>{
      library=value;
      const prototype=value?.Marker?.prototype;
      if(!prototype || prototype.__limaObserved)return;
      const add=prototype.addTo,remove=prototype.remove;
      prototype.addTo=function(map){
        const result=add.call(this,map);
        if(!collections.has(map))collections.set(map,new Set());
        collections.get(map).add(this);owners.set(this,map);
        return result;
      };
      prototype.remove=function(){
        const map=owners.get(this);
        if(map)collections.get(map)?.delete(this);
        owners.delete(this);
        return remove.call(this);
      };
      prototype.__limaObserved=true;
    }});
}
