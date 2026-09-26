// mapFit.js
// Encuadre del mapa: a una ruta (fitTo) o al conjunto de rutas que muestra
// una casilla de grupo (lote).
import { state } from './config.js';

export function fitTo(bounds){
  if (!bounds) return;
  // Leaflet descarta fitBounds si llega durante una animación de zoom
  if (state.map._animatingZoom){
    state.map.once('zoomend', () => fitTo(bounds));
    return;
  }
  state.map.fitBounds(bounds, fitPadding());
}

// Lo que tapa el mapa por abajo: la hoja del celular (state.mapInsets, de
// mobileSheet.js) y, encima de ella, el panel "Rutas en este punto"
function coveredBottom(){
  const map = state.map;
  let px = state.mapInsets?.bottom || 0;
  const ri = document.querySelector('.route-inspector:not([hidden])');
  if (px && ri && ri.offsetWidth >= map.getSize().x * 0.8) px += ri.offsetHeight + 8;
  return Math.min(px, map.getSize().y * 0.75);
}

function fitPadding(){
  if (state.mapInsets){
    return { paddingTopLeft: [20, 70], paddingBottomRight: [20, coveredBottom() + 20] };
  }
  const leftPad = document.getElementById('sidebar')?.offsetWidth ?? 380;
  return { paddingTopLeft: [leftPad + 20, 40], paddingBottomRight: [30, 40] };
}

// Centra un punto en la parte del mapa que se ve (sin la hoja ni el panel)
export function centerOn(latlng, zoom){
  const map = state.map;
  const dy = coveredBottom() / 2;
  if (!dy){ map.setView(latlng, zoom); return; }
  const p = map.project(latlng, zoom).add([0, dy]);
  map.setView(map.unproject(p, zoom), zoom);
}

/* ===========================
   Encuadre por lote (casillas de grupo)
   =========================== */

// Mientras hay un lote abierto, cada ruta que se muestra suma sus bounds;
// al cerrarlo se encuadra el conjunto completo (incluidas capas WR lazy).
let fitBatch = null;
let fitBatchDepth = 0;

export function addBoundsToBatch(batch, b){
  if (!batch || !b || !b.isValid || !b.isValid()) return;
  if (batch.bounds) batch.bounds.extend(b);
  else batch.bounds = L.latLngBounds(b.getSouthWest(), b.getNorthEast());
}

// Lote abierto ahora mismo (o null)
export function currentFitBatch(){
  return fitBatch;
}

export function beginFitBatch(){
  if (fitBatchDepth++ === 0) fitBatch = { bounds: null, pending: [] };
}

export async function endFitBatch(){
  if (fitBatchDepth === 0 || --fitBatchDepth > 0) return;
  const batch = fitBatch;
  fitBatch = null;
  await Promise.all(batch.pending);
  if (state.autoFit && batch.bounds) fitTo(batch.bounds.pad(0.04));
}
