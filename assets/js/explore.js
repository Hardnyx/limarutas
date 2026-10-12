// Independent ATU planning layer. It never registers operational services.
import { state } from './config.js';
import { el, fetchJSON } from './utils.js';

const labels = { metro: 'Metro', brt: 'BRT', corredor: 'Corredores', bus: 'Buses', infraestructura: 'Infraestructura' };
const norm = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let loaded, group;

function info(feature){
  const p = feature.properties;
  const box = el('div', { class: 'project-info' }, el('strong', {}, p.nombre),
    el('p', {}, 'Proyectado · '+labels[p.modo]),
    el('p', {}, p.horizonte_nombre+' · '+p.plan),
    el('p', {}, 'Estado en la fuente: '+p.source_state),
    el('p', {}, 'Tecnología ATU: '+p.source_type));
  if (p.source_last_modified) box.append(el('p', {}, 'Última modificación del archivo: '+new Date(p.source_last_modified).toLocaleDateString('es-PE',{timeZone:'UTC'})));
  box.append(el('a', { href: p.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'Fuente ATU · '+p.source_dataset));
  if (p.horizonte === 0) box.append(el('p', {}, 'Escenario base del PMU; consulta la pestaña Rutas para los servicios operativos.'));
  return box;
}

export function mountExplorePane(){
  const pane = el('div', { class: 'side-pane', id: 'explorePane', role: 'tabpanel', 'aria-labelledby': 'tabExplore', hidden: '' });
  const title = el('h2', {}, 'Red proyectada ATU');
  const note = el('p', { class: 'muted' }, 'Trazados del PMU 2025-2045. No participan en Cómo llegar. La fuente no incluye puntos de estaciones.');
  const search = el('input', { type: 'search', placeholder: 'Buscar un proyecto o avenida', 'aria-label': 'Buscar proyectos ATU' });
  const mode = el('select', { 'aria-label': 'Tecnología del proyecto' }, el('option', { value: '' }, 'Todas las tecnologías'));
  const horizon = el('select', { 'aria-label': 'Horizonte del proyecto' }, el('option', { value: '' }, 'Todos los horizontes'));
  const count = el('p', { class: 'muted', role: 'status', id: 'exploreCount' }, 'Abre Explorar para cargar los proyectos.');
  const clear = el('button', { type: 'button', class: 'btn small' }, 'Quitar proyectos del mapa');
  const list = el('div', { class: 'explore-list' });
  const details = el('div', { id:'projectDetails', hidden:'' });
  pane.append(title,note,search,el('div',{class:'explore-filters'},mode,horizon),clear,count,details,list);
  const selected = new Map();
  clear.addEventListener('click', () => {
    group?.clearLayers(); selected.clear(); details.hidden=true; details.replaceChildren();
    list.querySelectorAll('input[type=checkbox]').forEach(c => { c.checked=false; });
  });
  const filter = () => {
    const words=norm(search.value).split(/\s+/).filter(Boolean);
    let shown=0;
    for(const row of list.children){
      row.hidden = !!((mode.value && row.dataset.mode!==mode.value) ||
        (horizon.value && row.dataset.horizon!==horizon.value) || !words.every(w=>row.dataset.search.includes(w)));
      if(!row.hidden) shown++;
    }
    count.textContent=shown+' de '+list.children.length+' trazados';
  };
  search.addEventListener('input',filter); mode.addEventListener('change',filter); horizon.addEventListener('change',filter);
  pane.load = async () => {
    if(loaded) return loaded;
    count.textContent='Cargando proyectos ATU…';
    loaded=(async()=>{
      const [data,catalog]=await Promise.all([fetchJSON('data/processed/planificado/red.geojson'),fetchJSON('data/processed/planificado/catalog.json')]);
      for(const key of Object.keys(catalog.types)) mode.append(el('option',{value:key},labels[key]||key));
      for(const [key,label] of Object.entries(catalog.horizons)) horizon.append(el('option',{value:key},label));
      state.map.createPane('projectLine'); state.map.getPane('projectLine').style.zIndex='410';
      group=L.layerGroup().addTo(state.map);
      for(const feature of data.features){
        const p=feature.properties;
        if(p.operativo!==false || p.ruteable!==false || p.plannerEligible!==false) throw new Error('Estado de proyecto inválido');
        const check=el('input',{type:'checkbox','aria-label':p.nombre});
        const show=el('button',{type:'button',class:'project-name'},p.nombre);
        const row=el('div',{class:'project-row','data-id':p.id,'data-mode':p.modo,'data-horizon':String(p.horizonte),
          'data-search':norm(p.nombre+' '+p.source_type)},el('div',{class:'project-head'},check,show),
          el('span',{class:'project-badge'},'Proyectado'),el('span',{class:'muted'},' · '+p.horizonte_nombre));
        const draw=()=>{
          if(!selected.has(p.id)){
            const layer=L.geoJSON(feature,{pane:'projectLine',style:{color:p.color,weight:4,opacity:.7,dashArray:'8 6',smoothFactor:0}});
            layer.bindPopup(()=>info(feature)); group.addLayer(layer); selected.set(p.id,layer);
          }
          return selected.get(p.id);
        };
        check.addEventListener('change',()=>{
          if(check.checked) draw(); else {group.removeLayer(selected.get(p.id));selected.delete(p.id);}
        });
        show.addEventListener('click',()=>{
          check.checked=true; const layer=draw(); state.map.fitBounds(layer.getBounds(),{padding:[30,30],maxZoom:15});
          details.replaceChildren(info(feature)); details.hidden=false;
        });
        list.append(row);
      }
      filter();
    })().catch(error=>{loaded=null;count.textContent='No se pudieron cargar los proyectos. Vuelve a abrir Explorar.';console.warn('ATU',error.message);});
    return loaded;
  };
  return pane;
}
