// stopsGuard.js
// Advertencia de rendimiento: con muchas rutas a la vez, sus paraderos son
// miles de puntos y el mapa se vuelve lento. Se avisa al activar "Mostrar
// paradas" con muchas rutas visibles y al mostrar muchas rutas de golpe
// (casillas de grupo, "Mostrar las N rutas") con los paraderos activos.
import { state } from './config.js';
import { $ } from './utils.js';
import { reRenderVisible, countVisibleWrRoutes } from './mapLayers.js';

// A partir de cuántas rutas se pide confirmación
export const STOPS_CONFIRM_ROUTES = 30;

export function setShowStops(visible){
  state.showStops = !!visible;
  const chk = $('#chkStops');
  if (chk) chk.checked = state.showStops;
  reRenderVisible();
}

// Al activar "Mostrar paradas": true si se puede seguir
export function confirmShowStops(){
  const n = countVisibleWrRoutes();
  if (n <= STOPS_CONFIRM_ROUTES) return true;
  return window.confirm(
    `Hay ${n} rutas visibles. Mostrar todos sus paraderos puede volver lento el mapa.\n\n¿Mostrarlos de todos modos?`
  );
}

// Antes de mostrar n rutas nuevas de golpe: ofrece ocultar los paraderos
export function confirmManyRoutes(n){
  if (!state.showStops) return;
  const total = n + countVisibleWrRoutes();
  if (total <= STOPS_CONFIRM_ROUTES) return;
  const hide = window.confirm(
    `Vas a mostrar ${total} rutas con todos sus paraderos, y eso puede volver lento el mapa.\n\n` +
    `Aceptar: ocultar los paraderos (recomendado)\nCancelar: mostrarlos igual`
  );
  if (hide) setShowStops(false);
}
