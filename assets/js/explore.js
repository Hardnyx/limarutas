// Independent ATU planning layer. It never registers operational services.
import { state } from './config.js';
import { el, fetchJSON } from './utils.js';
import { isLightColor } from './mapColors.js';
import { setPanelOpen } from './panels.js';
import { leavesOfGroup, syncGroupCheckbox } from './uiSidebar.hierarchy.js';

const labels = { metro: 'Metro', brt: 'BRT', corredor: 'Corredores', bus: 'Buses', infraestructura: 'Teleféricos e infraestructura' };
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
  if (p.station_reference){
    const reference = p.station_reference;
    box.append(el('h3', {}, 'Estaciones de referencia'),
      el('p', {}, 'Nombres del concesionario o del estudio citado; ubicación pendiente de verificación.'));
    const stations = el('ol', {});
    for (const station of reference.stations) stations.append(el('li', {}, station.name));
    box.append(stations, el('a', {href: reference.sourceUrl, target: '_blank', rel: 'noopener noreferrer'}, 'Fuente de los nombres de estaciones'));
  }
  return box;
}

export function mountExplorePane(){
  const pane = el('div', { class: 'side-pane', id: 'explorePane', role: 'tabpanel', 'aria-labelledby': 'tabExplore', hidden: '' });
  const title = el('h2', {}, 'Red proyectada ATU');
  const note = el('p', { class: 'muted' }, 'Trazados del PMU 2025-2045. No participan en Cómo llegar. La fuente no incluye puntos de estaciones.');
  const search = el('input', { type: 'search', placeholder: 'Buscar un proyecto o avenida', 'aria-label': 'Buscar proyectos ATU' });
  const horizon = el('select', { 'aria-label': 'Horizonte del proyecto' }, el('option', { value: '' }, 'Todos los horizontes'));
  const count = el('p', { class: 'muted', role: 'status', id: 'exploreCount' }, 'Abre Explorar para cargar los proyectos.');
  const clear = el('button', { type: 'button', class: 'btn small' }, 'Quitar proyectos del mapa');
  const list = el('div', { class: 'explore-list', id: 'explorePanels' });
  const details = el('div', { id:'projectDetails', hidden:'' });
  pane.append(title,note,search,el('div',{class:'explore-filters'},horizon),clear,count,list);
  const selected = new Map();
  const rows = [], groups = new Map();
  let beforeFilter;
  const syncGroups = () => {
    for(const g of groups.values()){
      syncGroupCheckbox(g.check);
      const leaves = leavesOfGroup(g.check);
      g.count.textContent = String(leaves.length);
      g.count.classList.toggle('has-on',leaves.some(c=>c.checked));
    }
  };
  clear.addEventListener('click', () => {
    group?.clearLayers(); selected.clear(); details.hidden=true; details.replaceChildren();
    rows.forEach(row => { row.querySelector('input').checked=false; });
    syncGroups();
  });
  const filter = () => {
    const words=norm(search.value).split(/\s+/).filter(Boolean);
    const activeFilter=words.length || horizon.value;
    if(activeFilter && !beforeFilter) beforeFilter=new Map([...groups].map(([key,g])=>[key,g.panel.classList.contains('open')]));
    let shown=0;
    for(const row of rows){
      row.hidden = !!((horizon.value && row.dataset.horizon!==horizon.value) || !words.every(w=>row.dataset.search.includes(w)));
      row.classList.toggle('is-text-filtered',row.hidden);
      if(!row.hidden) shown++;
    }
    for(const g of groups.values()){
      g.panel.hidden = !g.body.querySelector('.project-row:not([hidden])');
      if(activeFilter) setPanelOpen(g.head,!g.panel.hidden);
      else if(beforeFilter) setPanelOpen(g.head,beforeFilter.get(g.panel.dataset.mode));
    }
    if(!activeFilter) beforeFilter=null;
    count.textContent=shown+' de '+rows.length+' trazados';
    syncGroups();
  };
  search.addEventListener('input',filter); horizon.addEventListener('change',filter);
  list.addEventListener('click', event => {
    const head = event.target.closest('.panel-head');
    if(!head || event.target.closest('input') || !document.documentElement.classList.contains('beta')) return;
    queueMicrotask(()=>{
      if(head.getAttribute('aria-expanded')!=='true') return;
      for(const g of groups.values()) if(g.head!==head) setPanelOpen(g.head,false);
    });
  });
  pane.load = async () => {
    if(loaded) return loaded;
    count.textContent='Cargando proyectos ATU…';
    loaded=(async()=>{
      const [data,catalog]=await Promise.all([fetchJSON('data/processed/planificado/red.geojson'),fetchJSON('data/processed/planificado/catalog.json')]);
      // Validate before mounting so a failed load cannot leave partial groups on retry.
      if(data.features.some(f=>f.properties.operativo!==false || f.properties.ruteable!==false || f.properties.plannerEligible!==false)) throw new Error('Estado de proyecto inválido');
      rows.length=0; groups.clear(); list.replaceChildren();
      horizon.replaceChildren(el('option',{value:''},'Todos los horizontes'));
      for(const [key,label] of Object.entries(catalog.horizons)) horizon.append(el('option',{value:key},label));
      if(!state.map.getPane('projectLine')) state.map.createPane('projectLine');
      state.map.getPane('projectLine').style.zIndex='410';
      if(group) state.map.removeLayer(group);
      group=L.layerGroup().addTo(state.map);
      selected.clear();
      for(const key of Object.keys(labels).filter(k=>catalog.types[k])){
        const body=el('div',{id:'explore-'+key,class:'panel-body list',style:'display:none','aria-label':labels[key]});
        const check=el('input',{type:'checkbox',class:'right','aria-label':'Mostrar todos los proyectos de '+labels[key]});
        const total=el('span',{class:'panel-count'},String(catalog.types[key]));
        const head=el('button',{type:'button',class:'panel-head','data-target':body.id,'aria-expanded':'false'},
          el('span',{class:'chev'},'▸'),el('span',{class:'title'},labels[key]),total,check);
        const panel=el('section',{class:'panel','data-mode':key},head,body);
        check.addEventListener('change',()=>{
          const leaves=leavesOfGroup(check);
          const checked=check.checked;
          for(const leaf of leaves){
            if(leaf.checked===checked) continue;
            leaf.checked=checked;leaf.dispatchEvent(new Event('change'));
          }
          syncGroups();
        });
        groups.set(key,{panel,head,body,check,count:total});list.append(panel);
      }
      const order=new Intl.Collator('es',{numeric:true,sensitivity:'base'});
      for(const feature of [...data.features].sort((a,b)=>order.compare(a.properties.nombre,b.properties.nombre)||a.properties.horizonte-b.properties.horizonte)){
        const p=feature.properties;
        const check=el('input',{type:'checkbox','aria-label':p.nombre});
        const line=p.modo==='metro' ? p.nombre.match(/Línea\s+(\d+)/i)?.[1] : null;
        const short=line ? 'Línea '+line+(p.nombre.includes('(Ramal)')?' · Ramal':/Ampliación/i.test(p.nombre)?' · Extensión':'') : p.nombre;
        const show=el('button',{type:'button',class:'project-name name'},short);
        const badge=el('span',{class:isLightColor(p.color)?'tag on-light':'tag',style:'background:'+p.color,
          title:'Color de la simbología del geovisor ATU'},line?'L'+line:p.modo==='brt'?'BRT':p.modo==='corredor'?'BUS':'TC');
        const text=el('div',{class:'project-text'},show,
          ...(line?[el('div',{class:'sub'},p.nombre)]:[]),
          el('div',{class:'sub'},el('span',{class:'project-badge'},p.horizonte===0?'Escenario base':'Proyectado'),' · '+p.horizonte_nombre));
        const row=el('div',{class:'item project-row','data-id':p.id,'data-mode':p.modo,'data-horizon':String(p.horizonte),
          'data-search':norm(p.nombre+' '+p.source_type)},el('div',{class:'item-head'},el('div',{class:'left'},badge,text),check));
        const draw=()=>{
          if(!selected.has(p.id)){
            const layer=L.geoJSON(feature,{pane:'projectLine',style:{color:p.color,weight:p.source_line_width,opacity:.85,dashArray:'8 6',smoothFactor:0}});
            layer.bindPopup(()=>info(feature)); group.addLayer(layer); selected.set(p.id,layer);
          }
          return selected.get(p.id);
        };
        check.addEventListener('change',()=>{
          if(check.checked) draw(); else {
            const layer=selected.get(p.id);if(layer) group.removeLayer(layer);selected.delete(p.id);
          }
          syncGroups();
        });
        show.addEventListener('click',()=>{
          check.checked=true; const layer=draw(); state.map.fitBounds(layer.getBounds(),{padding:[30,30],maxZoom:15});
          details.replaceChildren(info(feature)); row.append(details); details.hidden=false;syncGroups();
        });
        rows.push(row);groups.get(p.modo).body.append(row);
      }
      filter();
    })().catch(error=>{loaded=null;count.textContent='No se pudieron cargar los proyectos. Vuelve a abrir Explorar.';console.warn('ATU',error.message);});
    return loaded;
  };
  return pane;
}
