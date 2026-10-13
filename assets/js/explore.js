// Independent ATU planning layer. It never registers operational services.
import { state } from './config.js';
import { el, fetchJSON } from './utils.js';
import { isLightColor } from './mapColors.js';
import { setPanelOpen } from './panels.js';
import { leavesOfGroup, syncGroupCheckbox } from './uiSidebar.hierarchy.js';
import { icon } from './icons.js';
import { createCorridorPolicy, CORR_KEY_LABEL, CORR_GROUP_ORDER } from './corridorPolicy.js';

const labels = { metro: 'Metro', brt: 'BRT', corredor: 'Corredores', bus: 'Buses', infraestructura: 'Teleféricos e infraestructura' };
const norm = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let loaded, group;
let stationCatalog;
const visiblePoint = record => record.display_geometry || record.geometry;
const projectColor = feature => feature.properties.display_color || feature.properties.color;

function preview(feature){
  const parts=feature.geometry.coordinates;
  const points=parts.flat();const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const west=Math.min(...xs),east=Math.max(...xs),south=Math.min(...ys),north=Math.max(...ys);
  const latitude=(south+north)/2,aspect=Math.cos(latitude*Math.PI/180);
  const scale=Math.min(260/Math.max((east-west)*aspect,.00001),110/Math.max(north-south,.00001));
  const x=p=>20+(p[0]-west)*aspect*scale,y=p=>130-(p[1]-south)*scale;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 300 150');svg.setAttribute('class','project-track-preview');
  svg.setAttribute('role','img');svg.setAttribute('aria-label','Trazado de '+feature.properties.nombre);
  for(const part of parts){
    const path=document.createElementNS(svg.namespaceURI,'path');
    path.setAttribute('d',part.map((p,i)=>(i?'L':'M')+x(p).toFixed(2)+','+y(p).toFixed(2)).join(' '));
    path.setAttribute('fill','none');path.setAttribute('stroke',projectColor(feature));
    path.setAttribute('stroke-width','3');path.setAttribute('stroke-dasharray','6 4');svg.append(path);
  }
  return svg;
}
const pointTypes={estacion:'Estaciones',centro_transferencia:'Centros de transferencia',nodo_intermodal:'Nodos intermodales',nodo_dot:'Nodos DOT',terminal:'Terminales'};
const methodLabels={unlocated:'Ubicación pendiente de verificación',official_coordinate:'Coordenada oficial',geopdf_digitized:'Símbolo de GeoPDF',georeferenced_map_digitized:'Símbolo de mapa georreferenciado',documented_intersection:'Referencia de cruce vial'};

function pointInfo(record){
  const box=el('div',{class:'project-info'},el('strong',{},record.nombre),
    el('p',{},pointTypes[record.tipo]+' · '+record.estado),
    el('p',{},methodLabels[record.location_method]),el('p',{},record.uncertainty_note));
  if(record.notes) box.append(el('p',{},record.notes));
  if(record.connections) box.append(el('p',{},'Conexiones propuestas: '+record.connections));
  if(record.display_adjustment) box.append(el('p',{},record.display_adjustment.note));
  const chips=el('div',{class:'ri-chips'});
  for(const id of record.project_ids){
    const feature=stationCatalog.axes.get(id);if(!feature)continue;
    const button=el('button',{type:'button',class:'ri-chip',style:'--chip-color:'+projectColor(feature)},feature.properties.nombre);
    button.addEventListener('click',()=>document.querySelector(`.project-row[data-id="${CSS.escape(id)}"] .project-name`)?.click());
    chips.append(button);
  }
  if(chips.childNodes.length) box.append(chips);
  for(const ref of record.source_refs) box.append(el('p',{},el('a',{href:ref.url,target:'_blank',rel:'noopener noreferrer'},
    stationCatalog.sources[ref.source_id].name+' · '+ref.edition+(ref.pdf_page?' · PDF '+ref.pdf_page:''))));
  return box;
}

function info(feature){
  const p = feature.properties;
  const box = el('div', { class: 'project-info' }, el('strong', {}, p.nombre),preview(feature),
    el('p', {}, 'Proyectado · '+labels[p.modo]),
    el('p', {}, p.horizonte_nombre+' · '+p.plan),
    el('p', {}, 'Estado en la fuente: '+p.source_state),
    el('p', {}, 'Tecnología ATU: '+p.source_type));
  if(p.display_corridor) box.append(el('p',{},CORR_KEY_LABEL[p.display_corridor.corridor]+' · identidad del eje'),
    el('a',{href:p.display_corridor.source_url,target:'_blank',rel:'noopener noreferrer'},'Fuente del color y eje de corredor'));
  if (p.source_last_modified) box.append(el('p', {}, 'Última modificación del archivo: '+new Date(p.source_last_modified).toLocaleDateString('es-PE',{timeZone:'UTC'})));
  box.append(el('a', { href: p.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'Fuente ATU · '+p.source_dataset));
  if (p.horizonte === 0) box.append(el('p', {}, 'Escenario base del PMU; consulta la pestaña Rutas para los servicios operativos.'));
  const records=stationCatalog?.records.filter(r=>r.project_ids.includes(p.id)) || [];
  for(const [kind,label] of Object.entries(pointTypes)){
    const matches=records.filter(r=>r.tipo===kind).sort((a,b)=>(a.sequence||0)-(b.sequence||0));
    if(!matches.length) continue;
    box.append(el('h3',{},label+' de referencia'),el('p',{},'Posiciones cartográficas y referencias aproximadas; no representan accesos ni servicios operativos.'));
    const list=el('ol',{'data-point-type':kind,class:kind==='estacion'?'project-station-diagram':'','style':'--project-color:'+projectColor(feature)});
    for(const record of matches){
      const point=visiblePoint(record);
      const name=point?el('button',{type:'button',class:'project-point-name'},record.nombre):el('span',{},record.nombre);
      if(point) name.addEventListener('click',()=>{
        state.map.setView([point.coordinates[1],point.coordinates[0]],16);
        L.popup({pane:'projectPoints'}).setLatLng([point.coordinates[1],point.coordinates[0]]).setContent(pointInfo(record)).openOn(state.map);
      });
      const ref=record.source_refs[0];
      list.append(el('li',{'data-point-id':record.id},name,
        el('div',{class:'sub'},methodLabels[record.location_method]),
        el('a',{class:'sub',href:ref.url,target:'_blank',rel:'noopener noreferrer'},stationCatalog.sources[ref.source_id].name+(ref.pdf_page?' · PDF '+ref.pdf_page:''))));
    }
    box.append(list);
  }
  if(!records.some(r=>r.tipo==='estacion')) box.append(el('p',{class:'muted'},'No hay una lista de estaciones verificada para este eje.'));
  if(/Línea 2/.test(p.nombre)) box.append(el('p',{class:'muted'},'Las cinco estaciones ya operativas de L2 se consultan en Rutas y no se duplican como futuras.'));
  return box;
}

export function mountExplorePane(){
  const pane = el('div', { class: 'side-pane', id: 'explorePane', role: 'tabpanel', 'aria-labelledby': 'tabExplore', hidden: '' });
  const title = el('h2', {}, 'Red proyectada ATU');
  const note = el('p', { class: 'muted' }, 'Trazados del PMU 2025-2045 y estaciones documentadas. No participan en Cómo llegar. Los puntos aproximados indican su método y fuente.');
  const search = el('input', { type: 'search', placeholder: 'Buscar un proyecto o avenida', 'aria-label': 'Buscar proyectos ATU' });
  const clearSearch=el('button',{type:'button',class:'search-clear','aria-label':'Limpiar búsqueda de proyectos'},icon('close'));
  const searchBox=el('div',{class:'search'},el('span',{class:'loupe'},icon('search')),search,clearSearch);
  clearSearch.addEventListener('click',()=>{search.value='';filter();search.focus();});
  const horizon = el('select', { 'aria-label': 'Horizonte del proyecto' }, el('option', { value: '' }, 'Todos los horizontes'));
  const count = el('p', { class: 'muted', role: 'status', id: 'exploreCount' }, 'Abre Explorar para cargar los proyectos.');
  const clear = el('button', { type: 'button', class: 'btn small',id:'exploreClear','aria-label':'Quitar proyectos del mapa' }, 'Quitar todas');
  const all=el('button',{type:'button',class:'btn small',id:'exploreToggleAll','aria-pressed':'false'},'Marcar todo');
  const onMapCount=el('span',{class:'on-map-count',id:'exploreOnMapCount'},'0');
  const onMapList=el('div',{class:'on-map-list recent-list',id:'exploreOnMapList'});
  const onMapToggle=el('button',{type:'button',class:'on-map-toggle','aria-expanded':'true'},
    el('span',{class:'on-map-chev'},icon('chevron')),el('span',{class:'on-map-label'},'En el mapa'),onMapCount);
  onMapToggle.addEventListener('click',()=>{onMapList.hidden=!onMapList.hidden;onMapToggle.setAttribute('aria-expanded',String(!onMapList.hidden));});
  const onMap=el('div',{class:'on-map',id:'exploreOnMap',hidden:''},el('div',{class:'on-map-bar'},onMapToggle),onMapList);
  const list = el('div', { class: 'explore-list', id: 'explorePanels' });
  const details = el('div', { id:'projectDetails', hidden:'' });
  const pointControls=el('fieldset',{class:'project-point-controls'},el('legend',{},'Mostrar paradas y nodos'));
  const pointChecks=new Map();
  for(const [kind,label] of Object.entries(pointTypes)){
    const input=el('input',{type:'checkbox','data-point-type':kind});input.checked=kind==='estacion';
    pointChecks.set(kind,input);pointControls.append(el('label',{},input,' '+label));
    input.addEventListener('change',()=>drawPoints());
  }
  const pointCount=el('p',{class:'muted',id:'explorePointCount',role:'status'});
  const nodeList=el('details',{id:'exploreNodeList',hidden:''});
  const options=el('details',{class:'project-options'},el('summary',{},'Opciones de la red proyectada'),note,
    el('div',{class:'explore-filters'},horizon),pointControls,pointCount,nodeList);
  pane.append(title,searchBox,el('div',{class:'project-actions'},all,clear),onMap,options,count,list);
  const selected = new Map();
  let pointGroup;
  const drawPoints=()=>{
    if(!pointGroup || !stationCatalog) return;
    pointGroup.clearLayers();
    const records=stationCatalog.records.filter(r=>pointChecks.get(r.tipo)?.checked &&
      (selected.size?r.project_ids.some(id=>selected.has(id)):r.tipo!=='estacion'));
    nodeList.hidden=!!selected.size || !records.length;
    nodeList.replaceChildren(el('summary',{},'Nodos documentados · '+records.length));
    if(!nodeList.hidden){
      const names=el('ul',{});
      for(const record of records){
        const ref=record.source_refs[0];
        names.append(el('li',{},record.nombre,el('div',{class:'sub'},methodLabels[record.location_method]),
          el('a',{class:'sub',href:ref.url,target:'_blank',rel:'noopener noreferrer'},stationCatalog.sources[ref.source_id].name+(ref.pdf_page?' · PDF '+ref.pdf_page:''))));
      }
      nodeList.append(names);
    }
    for(const record of records.filter(r=>r.geometry && state.showStops)){
      const feature=stationCatalog.axes.get(record.project_ids.find(id=>selected.has(id))) || stationCatalog.axes.get(record.project_ids[0]);
      const color=record.tipo==='estacion'?(feature?projectColor(feature):'#657786'):'#7654b3';
      const point=visiblePoint(record),ll=[point.coordinates[1],point.coordinates[0]];
      const shape=record.tipo==='centro_transferencia'?'<path d="M9 1 L17 9 L9 17 L1 9 Z"/>':record.tipo==='nodo_dot'?'<rect x="2" y="2" width="14" height="14"/>':'<path d="M9 1 L17 16 L1 16 Z"/>';
      const marker=record.tipo==='estacion'?L.circleMarker(ll,{pane:'projectPoints',radius:5,weight:1.5,color:'#fff',fillColor:color,fillOpacity:1}):
        L.marker(ll,{pane:'projectPoints',icon:L.divIcon({className:'project-point-icon',html:`<svg viewBox="0 0 18 18" width="18" height="18" fill="${color}" stroke="white" stroke-width="1.5">${shape}</svg>`,iconSize:[18,18],iconAnchor:[9,9]}),title:record.nombre});
      marker.bindTooltip(record.nombre+' · Proyectado',{pane:'projectPoints'});
      marker.bindPopup(()=>pointInfo(record),{pane:'projectPoints'});pointGroup.addLayer(marker);
    }
    pointCount.textContent=(state.showStops?records.filter(r=>r.geometry).length:0)+' puntos visibles · '+records.filter(r=>!r.geometry).length+' ubicaciones pendientes';
  };
  document.getElementById('chkStops')?.addEventListener('change',()=>queueMicrotask(drawPoints));
  const rows = [], groups = new Map();
  let batching=0;
  const finishSelection=()=>{
    syncGroups();drawPoints();
    if(state.autoFit && selected.size) state.map.fitBounds(L.featureGroup([...selected.values()]).getBounds(),{padding:[30,30],maxZoom:15});
  };
  const batch=fn=>{batching++;try{fn();}finally{if(--batching===0)finishSelection();}};
  let beforeFilter;
  const syncGroups = () => {
    for(const g of groups.values()){
      syncGroupCheckbox(g.check);
      const leaves = leavesOfGroup(g.check);
      g.count.textContent = String(leaves.length);
      g.count.classList.toggle('has-on',leaves.some(c=>c.checked));
    }
    const visible=rows.filter(row=>!row.hidden).map(row=>row.querySelector('.item-head input'));
    const every=visible.length>0 && visible.every(check=>check.checked);
    all.textContent=every?'Desmarcar todo':'Marcar todo';all.setAttribute('aria-pressed',String(every));all.disabled=!visible.length;
    onMap.hidden=!selected.size;onMapCount.textContent=String(selected.size);onMapList.replaceChildren();
    for(const id of selected.keys()){
      const row=rows.find(r=>r.dataset.id===id),feature=stationCatalog.axes.get(id);
      const name=el('button',{type:'button',class:'project-name'},feature.properties.nombre);
      name.addEventListener('click',()=>row.querySelector('.project-name').click());
      const remove=el('button',{type:'button',class:'recent-remove','aria-label':'Quitar '+feature.properties.nombre},icon('close'));
      remove.addEventListener('click',()=>{const check=row.querySelector('.item-head input');check.checked=false;check.dispatchEvent(new Event('change'));});
      const color=projectColor(feature),line=feature.properties.nombre.match(/Línea\s+(\d+)/i)?.[1];
      const tag=el('span',{class:isLightColor(color)?'tag on-light':'tag',style:'background:'+color},line?'L'+line:feature.properties.modo==='brt'?'BRT':'BUS');
      onMapList.append(el('div',{class:'recent-item'},el('div',{class:'recent-row'},tag,name,remove)));
    }
  };
  all.addEventListener('click',()=>batch(()=>{
    const value=all.getAttribute('aria-pressed')!=='true';
    for(const row of rows.filter(r=>!r.hidden)){
      const check=row.querySelector('.item-head input');if(check.checked===value)continue;
      check.checked=value;check.dispatchEvent(new Event('change'));
    }
  }));
  clear.addEventListener('click', () => {
    group?.clearLayers(); selected.clear(); details.hidden=true; details.replaceChildren();
    rows.forEach(row => { row.querySelector('input').checked=false; });
    for(const [kind,input] of pointChecks) input.checked=kind==='estacion';
    drawPoints();state.map.closePopup();
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
    for(const [key,g] of groups){
      g.panel.hidden = !g.body.querySelector('.project-row:not([hidden])');
      if(activeFilter) setPanelOpen(g.head,!g.panel.hidden);
      else if(beforeFilter) setPanelOpen(g.head,beforeFilter.get(key));
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
      for(const g of groups.values()) if(g.head!==head && g.panel.parentElement===head.closest('.panel').parentElement) setPanelOpen(g.head,false);
    });
  });
  pane.load = async () => {
    if(loaded) return loaded;
    count.textContent='Cargando proyectos ATU…';
    loaded=(async()=>{
      const [data,catalog,points,styles]=await Promise.all([fetchJSON('data/processed/planificado/red.geojson'),fetchJSON('data/processed/planificado/catalog.json'),fetchJSON('data/processed/planificado/estaciones_catalogo.json'),fetchJSON('config/atu_project_styles.json')]);
      // Validate before mounting so a failed load cannot leave partial groups on retry.
      if(data.features.some(f=>f.properties.operativo!==false || f.properties.ruteable!==false || f.properties.plannerEligible!==false)) throw new Error('Estado de proyecto inválido');
      if(points.records.some(r=>r.operativo!==false || r.ruteable!==false || r.plannerEligible!==false || (r.geometry && r.geometry.type!=='Point'))) throw new Error('Estado de estación proyectada inválido');
      const corridorPolicy=createCorridorPolicy(state.catalog);
      const features=data.features.map(f=>{
        const style=styles.projects[f.id];
        return {...f,properties:{...f.properties,...(style?{display_corridor:style,display_color:corridorPolicy.color(style.code+'00')}: {})}};
      });
      stationCatalog={...points,axes:new Map(features.map(f=>[f.id,f]))};
      rows.length=0; groups.clear(); list.replaceChildren();
      horizon.replaceChildren(el('option',{value:''},'Todos los horizontes'));
      for(const [key,label] of Object.entries(catalog.horizons)) horizon.append(el('option',{value:key},label));
      if(!state.map.getPane('projectLine')) state.map.createPane('projectLine');
      state.map.getPane('projectLine').style.zIndex='410';
      if(group) state.map.removeLayer(group);
      group=L.layerGroup().addTo(state.map);
      if(!state.map.getPane('projectPoints')) state.map.createPane('projectPoints');
      state.map.getPane('projectPoints').style.zIndex='620';
      if(pointGroup) state.map.removeLayer(pointGroup);
      pointGroup=L.layerGroup().addTo(state.map);
      selected.clear();
      for(const key of Object.keys(labels).filter(k=>catalog.types[k])){
        const body=el('div',{id:'explore-'+key,class:'panel-body list',style:'display:none','aria-label':labels[key]});
        const check=el('input',{type:'checkbox',class:'right','aria-label':'Mostrar todos los proyectos de '+labels[key]});
        const total=el('span',{class:'panel-count'},String(catalog.types[key]));
        const head=el('button',{type:'button',class:'panel-head','data-target':body.id,'aria-expanded':'false'},
          el('span',{class:'chev'},'▸'),el('span',{class:'title'},labels[key]),total,check);
        const panel=el('section',{class:'panel','data-mode':key},head,body);
        check.addEventListener('change',()=>batch(()=>{
          const leaves=leavesOfGroup(check);
          const checked=check.checked;
          for(const leaf of leaves){
            if(leaf.checked===checked) continue;
            leaf.checked=checked;leaf.dispatchEvent(new Event('change'));
          }
        }));
        groups.set(key,{panel,head,body,check,count:total});list.append(panel);
      }
      const corridorParent=groups.get('corredor');
      if(corridorParent){
        for(const key of [...CORR_GROUP_ORDER.filter(k=>k!=='otros'),'unassigned']){
          const matches=features.filter(f=>f.properties.modo==='corredor' && (f.properties.display_corridor?.corridor || 'unassigned')===key);
          if(!matches.length)continue;
          const label=key==='unassigned'?styles.unassigned_label:CORR_KEY_LABEL[key];
          const id='explore-corredor-'+key,body=el('div',{id,class:'panel-body list',style:'display:none'});
          const check=el('input',{type:'checkbox',class:'right','aria-label':'Mostrar todos los proyectos de '+label});
          const total=el('span',{class:'panel-count'},String(matches.length));
          const head=el('button',{type:'button',class:'panel-head','data-target':id,'aria-expanded':'false'},el('span',{class:'chev'},'▸'),el('span',{class:'title'},label),total,check);
          const color=matches[0].properties.display_corridor?corridorPolicy.color(matches[0].properties.display_corridor.code+'00'):matches[0].properties.color;
          head.querySelector('.title').prepend(el('span',{class:'project-corridor-dot',style:'background:'+color}));
          const panel=el('section',{class:'panel','data-corridor':key},head,body);
          check.addEventListener('change',()=>batch(()=>{for(const leaf of leavesOfGroup(check)){if(leaf.checked===check.checked)continue;leaf.checked=check.checked;leaf.dispatchEvent(new Event('change'));}}));
          groups.set('corredor-'+key,{panel,head,body,check,count:total});corridorParent.body.append(panel);
        }
      }
      const order=new Intl.Collator('es',{numeric:true,sensitivity:'base'});
      for(const feature of [...features].sort((a,b)=>order.compare(a.properties.nombre,b.properties.nombre)||a.properties.horizonte-b.properties.horizonte)){
        const p=feature.properties;
        const check=el('input',{type:'checkbox','aria-label':p.nombre});
        const line=p.modo==='metro' ? p.nombre.match(/Línea\s+(\d+)/i)?.[1] : null;
        const short=line ? 'Línea '+line+(p.nombre.includes('(Ramal)')?' · Ramal':/Ampliación/i.test(p.nombre)?' · Extensión':'') : p.nombre;
        const show=el('button',{type:'button',class:'project-name name'},short);
        const color=projectColor(feature);
        const badge=el('span',{class:isLightColor(color)?'tag on-light':'tag',style:'background:'+color,
          title:p.display_corridor?CORR_KEY_LABEL[p.display_corridor.corridor]:'Simbología del geovisor ATU'},icon(line?'subway':'bus'),line?'L'+line:p.modo==='brt'?'BRT':p.modo==='corredor'?'BUS':'TC');
        const text=el('div',{class:'project-text'},show,
          ...(line?[el('div',{class:'sub'},p.nombre)]:[]),
          el('div',{class:'sub'},el('span',{class:'project-badge'},p.horizonte===0?'Escenario base':'Proyectado'),' · '+p.horizonte_nombre));
        const row=el('div',{class:'item project-row','data-id':p.id,'data-mode':p.modo,'data-horizon':String(p.horizonte),
          'data-search':norm(p.nombre+' '+p.source_type+' '+(CORR_KEY_LABEL[p.display_corridor?.corridor]||''))},el('div',{class:'item-head'},el('div',{class:'left'},badge,text),check));
        const draw=()=>{
          if(!selected.has(p.id)){
            const layer=L.geoJSON(feature,{pane:'projectLine',style:{color,weight:p.source_line_width,opacity:.85,dashArray:'8 6',smoothFactor:0}});
            layer.bindPopup(()=>info(feature),{pane:'projectPoints'}); group.addLayer(layer); selected.set(p.id,layer);
            layer.on('mouseover',()=>layer.setStyle({weight:p.source_line_width+2,opacity:1}));
            layer.on('mouseout',()=>layer.setStyle({weight:p.source_line_width,opacity:.85}));
            layer.on('click',()=>{details.replaceChildren(info(feature));row.append(details);details.hidden=false;});
          }
          return selected.get(p.id);
        };
        check.addEventListener('change',()=>{
          if(check.checked) draw(); else {
            const layer=selected.get(p.id);if(layer) group.removeLayer(layer);selected.delete(p.id);
          }
          if(!batching)finishSelection();
        });
        show.addEventListener('click',()=>{
          check.checked=true; const layer=draw(); state.map.fitBounds(layer.getBounds(),{padding:[30,30],maxZoom:15});
          details.replaceChildren(info(feature)); row.append(details); details.hidden=false;syncGroups();drawPoints();
        });
        rows.push(row);groups.get(p.modo==='corredor'?'corredor-'+(p.display_corridor?.corridor || 'unassigned'):p.modo).body.append(row);
      }
      filter();
      drawPoints();
    })().catch(error=>{loaded=null;count.textContent='No se pudieron cargar los proyectos. Vuelve a abrir Explorar.';console.warn('ATU',error.message);});
    return loaded;
  };
  return pane;
}
