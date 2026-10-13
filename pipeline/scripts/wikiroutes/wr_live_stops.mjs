// Match named stops by their public stable IDs; never by marker array position.
export function resolveStops(names,markers){
  if(!markers)return {stops:null,status:'unavailable'};
  const byId=new Map();
  for(const marker of markers){
    const id=String(marker.id||'');
    if(!id)continue;
    if(byId.has(id) && JSON.stringify(byId.get(id).coordinates)!==JSON.stringify(marker.coordinates))byId.set(id,{coordinates:null});
    else if(!byId.has(id))byId.set(id,marker);
  }
  const stops=names.map((n,i)=>({id:String(n.id),name:n.name,sequence:i+1,coordinates:byId.get(String(n.id))?.coordinates || null}));
  return {stops,status:stops.every(s=>s.coordinates)?'located':'coordinates_unavailable',
    observation:{named_stops:names.length,rendered_markers:markers.length,located_stops:stops.filter(s=>s.coordinates).length}};
}
