import { RouteAuthoringClient } from './routeAuthoringClient.js';
import { RouteEditorState } from './routeAuthoringState.js';

const $ = id => document.getElementById(id);
const api = new RouteAuthoringClient(), state = new RouteEditorState();
let online = false, busy = false, mode = '', range = null, waypoints = [], pendingPath = false, viewportTimer, viewportVersion = 0;
let updateBundle = null, updateProposal = null, updateChoices = {};
const map = L.map('editorMap', { zoomControl: false }).setView([-12.055, -77.035], 15);
map.createPane('streetPane').style.zIndex = 390;
map.createPane('originalPane').style.zIndex = 395;
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © CARTO'
}).addTo(map);
const streets = L.layerGroup().addTo(map), original = L.layerGroup().addTo(map), track = L.layerGroup().addTo(map), markers = L.layerGroup().addTo(map);
const anchorMarkers = L.layerGroup().addTo(map);
const incomingSource = L.layerGroup().addTo(map);
const latlng = point => [point[1], point[0]];
const point = ll => [ll.lng, ll.lat];
const reserved = edge => ['separate_busway', 'restricted_bus_road'].includes(edge.facility);

function node(tag, text, className){ const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
function message(text, error = false){ $('editorMessage').textContent = text; $('editorMessage').dataset.error = String(error); }
function controls(){
  const pack = state.pack, disabled = busy || !online || !!updateBundle;
  $('connection').textContent = busy ? 'Procesando…' : online ? 'Motor conectado' : 'Motor desconectado';
  $('routeTools').inert = busy;
  for (const panel of document.querySelectorAll('[data-panel="path"],[data-panel="stops"]')) panel.inert = !!updateBundle;
  $('reviewNotes').disabled = disabled;
  $('routeTools').hidden = !pack; $('offlineHelp').hidden = online;
  for (const id of ['newRoute','importFile','routeQuery']) $(id).disabled = disabled;
  for (const id of ['saveDraft','exportPreview','addWaypoint','addStop','selectRange','serviceMode','serviceSystem']) $(id).disabled = disabled || !pack;
  $('undo').disabled = disabled || !state.past.length; $('redo').disabled = disabled || !state.future.length;
  $('cancelChanges').disabled = disabled || (!state.dirty && !pendingPath);
  $('saveDraft').disabled = disabled || !pack || pendingPath;
  $('matchSource').disabled = disabled || !pack?.route.source.track;
  $('acceptRoute').disabled = disabled || pendingPath || !pack?.validation.ready;
  $('exportRoute').disabled = disabled || pendingPath || state.dirty || !pack?.route.review.accepted;
  $('applyPath').disabled = disabled || (!range && waypoints.length < 2) || (range && range.end == null);
  $('sourceUpdateFile').disabled = disabled || state.dirty || pendingPath || !state.persistedRevision || pack?.route.source.kind !== 'wikiroutes';
  $('applySourceUpdate').disabled = busy || !online || !updateProposal?.canApply;
  $('cancelSourceUpdate').disabled = busy || !updateBundle;
  $('editStatus').textContent = !pack ? 'Sin ruta abierta' : pendingPath ? 'Recorrido pendiente de aplicar' : state.dirty ? 'Cambios sin guardar' : pack.route.review.accepted ? 'Recorrido aceptado' : `Borrador · revisión ${state.persistedRevision}`;
}
async function run(fn){ if (busy) return; busy = true; controls(); try { await fn(); } catch (error){ message(error.message, true); } finally { busy = false; controls(); } }
async function connect(){ await run(async () => { await api.call('health'); online = true; message('Selecciona una ruta o importa un archivo con trazado y paraderos.'); await loadStreets(); }); }
function canSwitch(){ if (!state.dirty && !pendingPath) return true; message('Guarda el borrador o cancela sus cambios antes de abrir otra ruta.', true); return false; }
function open(pack){ clearSourceUpdate(); state.load(pack); mode = ''; range = null; pendingPath = false; waypoints = structuredClone(pack.route.anchors || []); $('routeEntry').open = false; render(true); }
function change(pack){ state.change(pack); render(); }
function switchTab(tab){ for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-pressed', String(button.dataset.tab === tab)); for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab; if (tab === 'stops') map.removeLayer(anchorMarkers); else anchorMarkers.addTo(map); }

async function loadStreets(){
  if (!online) return;
  const version = ++viewportVersion;
  if (map.getZoom() < 15){ streets.clearLayers(); return; }
  const bounds = map.getBounds();
  try {
    const result = await api.call('streets', { bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] });
    if (version !== viewportVersion) return;
    streets.clearLayers();
    for (const edge of result.edges){
      const layer = L.polyline(edge.coordinates.map(latlng), { pane: 'streetPane', color: reserved(edge) ? '#8b43b1' : edge.facility === 'bus_lane' ? '#849b8b' : '#a4b1c0', weight: reserved(edge) ? 5 : 4, opacity: .65 });
      layer.bindTooltip(`${edge.name || 'Calle sin nombre'}${reserved(edge) ? ' · calzada reservada' : edge.facility === 'bus_lane' ? ' · carril bus indicado' : ''}`);
      layer.on('click', event => { L.DomEvent.stopPropagation(event); run(() => chooseStreet(edge.id, event.latlng)); });
      layer.addTo(streets); layer.getElement()?.setAttribute('data-edge', edge.id);
    }
    if (result.truncated) message('Acerca el mapa para ver todas las calles de esta zona.');
  } catch (error){ if (version === viewportVersion) message(error.message, true); }
}
map.on('moveend', () => { clearTimeout(viewportTimer); viewportTimer = setTimeout(loadStreets, 180); });

async function chooseStreet(eid, location){
  if (updateBundle || !state.pack || !['waypoint','stop'].includes(mode)) return;
  const result = await api.call('resolve', { query: { kind: 'point', coordinates: point(location) } });
  const candidate = result.candidates.find(c => c.edge === eid);
  if (!candidate) throw new Error('No se pudo localizar el punto en la calle seleccionada.');
  if (mode === 'stop'){
    const name = $('stopName').value.trim();
    if (!name) throw new Error('Indica el nombre del paradero.');
    const route = state.requestRoute();
    route.stops.push({ id: `authored:${crypto.randomUUID()}`, name, coordinates: point(location),
      evidence: { kind: 'visual-placement', network: route.network, edge: eid, fraction: candidate.fraction } });
    change(await api.call('validate', { route })); $('stopName').value = ''; mode = ''; message('Paradero añadido. Puedes arrastrarlo para precisar su ubicación.');
  } else {
    waypoints.push({ edge: eid, fraction: candidate.fraction, coordinates: candidate.coordinates, name: candidate.name });
    pendingPath = true;
    renderWaypoints(); message('Paso añadido. Aplica el recorrido para calcularlo por las calles seleccionadas.');
  }
  controls();
}

function renderWaypoints(){
  $('waypointList').replaceChildren();
  anchorMarkers.clearLayers();
  waypoints.forEach((anchor, index) => {
    const li = node('li'), button = node('button', 'Quitar');
    li.append(node('span', anchor.name || `Paso ${index+1}`), button);
    button.addEventListener('click', () => { waypoints.splice(index, 1); pendingPath = true; renderWaypoints(); controls(); });
    $('waypointList').append(li);
    if (anchor.coordinates){
      const marker = L.marker(latlng(anchor.coordinates), {draggable:!updateBundle,icon:L.divIcon({className:'anchor-marker',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(anchorMarkers);
      marker.on('dragend', () => run(async () => {
        const result = await api.call('resolve',{query:{kind:'point',coordinates:point(marker.getLatLng())}});
        const options = node('div'); options.append(node('p','Selecciona la calzada para este paso:'));
        for (const candidate of result.candidates.slice(0,6)){
          const choice = node('button',`${candidate.name || 'Calle sin nombre'} · ${candidate.distanceM.toFixed(0)} m · ${candidate.edge}`);
          choice.addEventListener('click', () => { waypoints[index] = {edge:candidate.edge,fraction:candidate.fraction,coordinates:candidate.coordinates,name:candidate.name}; pendingPath = true; map.closePopup(); renderWaypoints(); message('Paso reubicado. Aplica el recorrido para guardar su trazado.'); }); options.append(choice);
        }
        marker.bindPopup(options).openPopup();
        if (!result.candidates.length) { marker.setLatLng(latlng(anchor.coordinates)); message('No hay una calle cercana; el paso conserva su posición anterior.',true); }
      }));
      marker.getElement()?.setAttribute('data-anchor-index',index);
    }
  });
  $('pathHint').textContent = range ? `Corrigiendo tramos ${range.start+1}${range.end != null ? ` a ${range.end+1}` : ': selecciona el final'}. El resto se conserva.` : 'Los pasos seleccionados se recorren en orden. Añade cruces intermedios para fijar el itinerario.';
  controls();
}

function render(fit = false){
  controls(); original.clearLayers(); track.clearLayers(); markers.clearLayers();
  const pack = state.pack; if (!pack) return;
  const route = pack.route;
  $('routeName').textContent = route.name; $('revision').textContent = `${route.direction} · r${state.persistedRevision}`;
  $('serviceMode').value = route.profile?.mode || 'mixed'; $('serviceSystem').value = route.profile?.system || '';
  $('reviewNotes').value = route.review.notes || '';
  const source = route.source.track;
  if (source) L.geoJSON(source, { pane: 'originalPane', style: { color: '#7b899b', weight: 5, opacity: .65, dashArray: '6 6' }, interactive: false }).addTo(original);
  for (const segment of pack.segments || []){
    const selected = range && segment.index >= range.start && (range.end == null ? segment.index === range.start : segment.index <= range.end);
    const layer = L.polyline(segment.coordinates.map(latlng), { color: selected ? '#e5a21e' : segment.type === 'gap' ? '#d24b35' : '#1260cc', weight: selected ? 7 : 4, opacity: .95 });
    layer.on('click', event => {
      L.DomEvent.stopPropagation(event);
      if (updateBundle || busy) return;
      if (mode === 'rangeStart' && segment.type === 'street'){ range = { start: segment.index, end: null }; waypoints = []; mode = 'rangeEnd'; render(); message('Selecciona el final del tramo que quieres sustituir.'); }
      else if (mode === 'rangeEnd' && segment.type === 'street'){
        if (segment.index < range.start){ message('El final debe ir después del inicio seleccionado.', true); return; }
        range.end = segment.index; mode = 'waypoint'; render(); message('Selecciona calles intermedias o aplica un recorrido directo entre estos extremos.');
      } else if (segment.type === 'street') run(() => chooseStreet(route.path[segment.index].edge, event.latlng));
    });
    layer.addTo(track); layer.getElement()?.setAttribute('data-path-index', segment.index);
  }
  route.stops.forEach((stop, index) => {
    const marker = L.marker(latlng(stop.coordinates), { draggable: !updateBundle, icon: L.divIcon({ className: 'stop-marker', iconSize: [14,14], iconAnchor: [7,7] }) });
    marker.bindTooltip(node('span', `${index+1}. ${stop.name}`));
    marker.on('dragend', () => run(async () => { const edited = state.requestRoute(); edited.stops[index].coordinates = point(marker.getLatLng()); change(await api.call('validate', { route: edited })); }));
    marker.addTo(markers); marker.getElement()?.setAttribute('data-stop-id', stop.id);
  });
  renderStops(); renderWaypoints();
  $('reviewSummary').textContent = `${(pack.validation.distanceM/1000).toFixed(2)} km · ${route.stops.length} paraderos · ${pack.validation.issues.length} avisos`;
  $('issueList').replaceChildren(...pack.validation.issues.map(issue => {
    const li = node('li', `${issue.message}${issue.pathIndex != null ? ` (tramo ${issue.pathIndex+1})` : ''}`);
    if (issue.pathIndex != null) li.addEventListener('click', () => { const segment = pack.segments[issue.pathIndex]; if (segment) map.fitBounds(L.latLngBounds(segment.coordinates.map(latlng)).pad(.7), { maxZoom: 19 }); });
    return li;
  }));
  $('mapHint').textContent = mode === 'waypoint' ? 'Haz clic en la calzada concreta por donde debe circular la ruta.' : mode === 'stop' ? 'Haz clic en una calle para ubicar el paradero.' : mode.startsWith('range') ? 'Haz clic sobre el recorrido azul para seleccionar el tramo.' : 'Gris: fuente original. Azul: recorrido actual. Morado: calzadas reservadas.';
  if (fit && pack.coordinates.length) map.fitBounds(L.latLngBounds(pack.coordinates.map(latlng)).pad(.2), { maxZoom: 18 });
}

function renderStops(){
  $('stopList').replaceChildren();
  state.pack.route.stops.forEach((stop, index) => {
    const li = node('li'), row = node('div', null, 'stop-row'), input = node('input');
    input.value = stop.name; input.setAttribute('aria-label', `Nombre del paradero ${index+1}`);
    input.addEventListener('change', () => run(async () => { const route = state.requestRoute(); route.stops[index].name = input.value; change(await api.call('validate', { route })); }));
    row.append(input);
    for (const [text, action] of [['↑','up'],['↓','down'],['×','remove']]){
      const button = node('button', text); button.setAttribute('aria-label', `${action === 'up' ? 'Subir' : action === 'down' ? 'Bajar' : 'Eliminar'} paradero ${index+1}`);
      button.disabled = action === 'up' && index === 0 || action === 'down' && index === state.pack.route.stops.length-1;
      button.addEventListener('click', () => run(async () => {
        const route = state.requestRoute();
        if (action === 'remove') route.stops.splice(index, 1);
        else { const other = index + (action === 'up' ? -1 : 1); [route.stops[index],route.stops[other]] = [route.stops[other],route.stops[index]]; }
        change(await api.call('validate', { route }));
      }));
      row.append(button);
    }
    li.append(row, node('div', stop.position ? `${stop.position.distanceM.toFixed(0)} m del trazado` : 'Pendiente de vincular al recorrido', 'stop-position')); $('stopList').append(li);
  });
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
$('routeSearch').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const result = await api.call('catalog', { query: $('routeQuery').value }); $('routeCandidates').replaceChildren();
  for (const route of [...result.drafts.map(r => ({ ...r, draft: true })), ...result.published]){
    const button = node('button', `${route.draft ? 'Borrador · ' : ''}${route.name}`);
    button.addEventListener('click', () => { if (canSwitch()) run(async () => { open(await api.call(route.draft ? 'get' : 'import-existing', { routeId: route.id })); message('Ruta abierta en un borrador.'); }); });
    $('routeCandidates').append(button);
  }
}); });
$('newRoute').addEventListener('click', () => { if (canSwitch()) $('newRouteForm').hidden = !$('newRouteForm').hidden; });
$('newRouteForm').addEventListener('submit', event => { event.preventDefault(); if (!canSwitch()) return; run(async () => { open(await api.call('new', { id: $('newId').value.trim(), name: $('newName').value.trim(), direction: $('newDirection').value })); $('newRouteForm').hidden = true; mode = 'waypoint'; render(); }); });
$('importFile').addEventListener('change', event => run(async () => {
  if (!canSwitch()) return; const file = event.target.files[0]; if (!file) return;
  const data = JSON.parse(await file.text());
  const draft = data.files ? Object.values(data.files).find(v => v.version === 1 && v.path && v.stops) : data.route || (data.version === 1 && data.path ? data : null);
  const pack = draft ? await api.call('restore', {route:draft}) : await api.call('import', { bundle: data });
  open(pack); message('Archivo importado. La fuente original se conserva.'); event.target.value = '';
}));
$('matchSource').addEventListener('click', () => run(async () => { change(await api.call('match', { route: state.requestRoute() })); message('Ajuste preparado. Revisa los avisos y compáralo con la fuente.'); }));
$('selectRange').addEventListener('click', () => { mode = 'rangeStart'; range = null; waypoints = []; render(); });
$('addWaypoint').addEventListener('click', () => { if (!range && !state.pack.route.anchors && state.pack.route.path.length){ mode = 'rangeStart'; message('Selecciona primero los extremos del tramo a corregir.'); } else mode = 'waypoint'; render(); });
$('applyPath').addEventListener('click', () => run(async () => {
  const request = range ? ['replace', { route: state.requestRoute(), fromPathIndex: range.start, toPathIndex: range.end, viaAnchors: waypoints }] : ['rebuild', { route: state.requestRoute(), anchors: waypoints }];
  const pack = await api.call(...request); range = null; pendingPath = false; waypoints = structuredClone(pack.route.anchors || []); mode = ''; change(pack); message('Recorrido actualizado. Los cambios siguen en el borrador.');
}));
$('addStop').addEventListener('click', () => { if (!$('stopName').value.trim()){ message('Indica primero el nombre del paradero.', true); return; } mode = 'stop'; render(); });
$('stopSearch').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const result = await api.call('resolve', { query: { kind: 'stop', query: $('stopQuery').value } }); $('stopCandidates').replaceChildren();
  for (const stop of result.candidates){ const button = node('button', `${stop.name}${stop.district ? ` · ${stop.district}` : ''}`); button.addEventListener('click', () => run(async () => { const route = state.requestRoute(); const occurrence = 1 + route.stops.filter(s => s.id === stop.id).length; route.stops.push({ ...stop, occurrence }); change(await api.call('validate', { route })); $('stopCandidates').replaceChildren(); })); $('stopCandidates').append(button); }
}); });
for (const id of ['serviceMode','serviceSystem']) $(id).addEventListener('change', () => run(async () => { const route = state.requestRoute(); route.profile = { mode: $('serviceMode').value, system: $('serviceSystem').value.trim() }; change(await api.call('validate', { route })); }));
$('undo').addEventListener('click', () => { state.undo(); pendingPath = false; range = null; waypoints = structuredClone(state.pack.route.anchors || []); render(); });
$('redo').addEventListener('click', () => { state.redo(); pendingPath = false; range = null; waypoints = structuredClone(state.pack.route.anchors || []); render(); });
$('cancelChanges').addEventListener('click', () => { state.cancel(); pendingPath = false; range = null; mode = ''; waypoints = structuredClone(state.pack.route.anchors || []); render(); message('Cambios locales cancelados.'); });
async function save(accept){ const route = state.requestRoute(); route.review.notes = $('reviewNotes').value; const pack = await api.call(accept ? 'accept' : 'save', { route, expectedRevision: state.persistedRevision }); state.markSaved(pack); render(); message(accept ? 'Recorrido aceptado para exportar.' : 'Borrador guardado. El sitio publicado no se modifica.'); }
$('reviewNotes').addEventListener('change',()=>run(async()=>{const route=state.requestRoute();route.review.notes=$('reviewNotes').value;change(await api.call('validate',{route}));}));
$('saveDraft').addEventListener('click', () => run(() => save(false)));
$('acceptRoute').addEventListener('click', () => run(() => save(true)));
async function download(preview){ const data = await api.call('export', { route: state.requestRoute(), preview }); const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], { type: 'application/json' })); const link = node('a'); link.href = url; link.download = `${state.pack.route.id.replace(/[^a-z0-9_-]/gi,'_')}${preview ? '-preview' : ''}.bundle.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('exportPreview').addEventListener('click', () => run(() => download(true)));
$('exportRoute').addEventListener('click', () => run(() => download(false)));
function clearSourceUpdate(){
  updateBundle = null; updateProposal = null; updateChoices = {};
  incomingSource.clearLayers(); $('incomingLegend').hidden = true;
  $('sourceUpdateFile').value = ''; $('sourceUpdateSummary').textContent = ''; $('sourceConflicts').replaceChildren();
}
async function compareSourceUpdate(){
  updateProposal = await api.call('propose-update', {routeId:state.pack.route.id,bundle:updateBundle,choices:updateChoices});
  const unresolved = updateProposal.conflicts.filter(c => !c.resolution).length;
  $('sourceUpdateSummary').textContent = `${updateProposal.sourceChanged ? 'Fuente nueva' : 'Fuente sin cambios'} · ${unresolved} conflictos pendientes · ${updateProposal.preview.validation.issues.length} avisos tras combinar.`;
  $('sourceConflicts').replaceChildren();
  for (const conflict of updateProposal.conflicts){
    const label = node('label', `Conflicto: ${conflict.key}`), select = node('select');
    select.setAttribute('aria-label',`Resolver ${conflict.key}`);
    for(const [value,text] of [['','Selecciona una decisión'],['local','Conservar mi edición'],['incoming','Usar la nueva fuente']]){const option=node('option',text);option.value=value;select.append(option);}
    select.value = conflict.resolution || '';
    const values = node('pre', `Mi edición: ${JSON.stringify(conflict.local)}\nNueva fuente: ${JSON.stringify(conflict.incoming)}`);
    values.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;font-size:11px';
    select.addEventListener('change', () => run(async () => { if(select.value) updateChoices[conflict.key]=select.value;else delete updateChoices[conflict.key];updateProposal=null;await compareSourceUpdate(); }));
    label.append(select); $('sourceConflicts').append(label,values);
  }
  incomingSource.clearLayers();
  L.geoJSON(updateBundle.track,{pane:'originalPane',style:{color:'#e18016',weight:5,dashArray:'3 6',opacity:.8},interactive:false}).addTo(incomingSource);
  $('incomingLegend').hidden = false; render();
}
$('sourceUpdateFile').addEventListener('change',event => run(async () => {
  const file = event.target.files[0]; if(!file) return;
  const data = JSON.parse(await file.text());
  if(!data.track || !data.stops) throw new Error('El archivo debe incluir el trazado y los paraderos de la fuente nueva.');
  updateBundle = data; updateChoices = {}; updateProposal = null;
  try { await compareSourceUpdate();message('Propuesta preparada. Tus cambios guardados siguen intactos.'); }
  catch(error){clearSourceUpdate();render();throw error;}
}));
$('cancelSourceUpdate').addEventListener('click',()=>{clearSourceUpdate();render();message('Propuesta descartada. Se conserva el borrador guardado.');});
$('applySourceUpdate').addEventListener('click',()=>run(async()=>{
  const pack = await api.call('apply-update',{routeId:state.pack.route.id,bundle:updateBundle,choices:updateChoices,expectedRevision:state.persistedRevision,proposalHash:updateProposal.proposalHash});
  open(pack); message('Fuente actualizada. Revisa el recorrido antes de volver a aceptarlo.');
}));
$('reconnect').addEventListener('click', connect);
window.addEventListener('beforeunload', event => { if (state.dirty || pendingPath){ event.preventDefault(); event.returnValue = ''; } });
controls(); connect();
