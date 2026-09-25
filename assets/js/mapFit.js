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
  const leftPad = document.getElementById('sidebar')?.offsetWidth ?? 380;
  state.map.fitBounds(bounds, {
    paddingTopLeft: [leftPad + 20, 40],
    paddingBottomRight: [30, 40]
  });
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
