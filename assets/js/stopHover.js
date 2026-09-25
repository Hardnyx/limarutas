// stopHover.js
// Nombre del paradero al pasar el mouse (o tocarlo). Un solo tooltip
// compartido para miles de paraderos. Mientras el cursor está sobre un
// paradero, el panel "Rutas en este punto" no se actualiza (isOverStop).
import { state } from './config.js';

let tip = null;
let overStop = false;
let pinnedByTap = false;

export function isOverStop(){
  return overStop;
}

export function setOverStop(v){
  overStop = !!v;
}

function showTip(latlng, name){
  if (!name) return;
  if (!tip) tip = L.tooltip({ direction: 'top', offset: [0, -6], className: 'stop-tip', opacity: 1 });
  tip.setLatLng(latlng).setContent(name);
  if (!state.map.hasLayer(tip)) tip.addTo(state.map);
}

function hideTip(){
  if (tip && state.map.hasLayer(tip)) state.map.removeLayer(tip);
}

// Paraderos WR (circleMarkers en canvas) con properties.name
export function wireStopLayer(layer){
  if (!layer || typeof layer.on !== 'function') return;
  layer.on('mouseover', (e) => {
    overStop = true;
    pinnedByTap = false;
    showTip(e.layer.getLatLng(), e.layer.feature?.properties?.name);
  });
  layer.on('mouseout', () => {
    overStop = false;
    if (!pinnedByTap) hideTip();
  });
  // Toque (pantallas táctiles) o clic: deja el nombre visible
  layer.on('click', (e) => {
    pinnedByTap = true;
    showTip(e.layer.getLatLng(), e.layer.feature?.properties?.name);
  });
}

export function wireStopHover(){
  // Un clic en otro lugar del mapa quita el nombre fijado
  state.map.on('click', () => { pinnedByTap = false; hideTip(); });
}
