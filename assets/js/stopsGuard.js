// stopsGuard.js
// Advertencia de rendimiento: con muchas rutas a la vez, sus paraderos son
// miles de puntos y el mapa se vuelve lento. Se pregunta con un diálogo de
// la página (uiDialog.js) al activar "Mostrar paradas" con muchas rutas
// visibles y al mostrar muchas rutas de golpe (casillas de grupo, "Mostrar
// las N rutas") con los paraderos activos.
import { state } from './config.js';
import { $ } from './utils.js';
import { reRenderVisible, countVisibleWrRoutes } from './mapLayers.js';
import { askChoice } from './uiDialog.js';
import { FLAGS } from './flags.js';

// A partir de cuántas rutas se pregunta
export const STOPS_CONFIRM_ROUTES = 30;

export function setShowStops(visible){
  state.showStops = !!visible;
  const chk = $('#chkStops');
  if (chk) chk.checked = state.showStops;
  reRenderVisible();
}

// ¿Hace falta preguntar? (sin diálogo, la acción sigue en el acto)
export function showStopsNeedsConfirm(){
  return countVisibleWrRoutes() > STOPS_CONFIRM_ROUTES;
}

export function manyRoutesNeedsConfirm(n){
  return state.showStops && n + countVisibleWrRoutes() > STOPS_CONFIRM_ROUTES;
}

// Al activar "Mostrar paradas": true si se deben mostrar
export async function confirmShowStops(){
  if (!showStopsNeedsConfirm()) return true;
  const n = countVisibleWrRoutes();
  const v = await askChoice({
    title: 'Mostrar paraderos',
    message: `Hay ${n} rutas visibles. Mostrar todos sus paraderos puede volver lento el mapa.`,
    choices: [
      { label: 'Mostrar paraderos', value: 'stops' },
      { label: 'Cancelar', value: 'cancel', primary: true }
    ],
    cancelValue: 'cancel'
  });
  return v === 'stops';
}

// Antes de mostrar n rutas nuevas de golpe. Devuelve false si el usuario
// cancela; si elige "sin paraderos", los desactiva antes de dibujar
export async function confirmManyRoutes(n){
  if (!manyRoutesNeedsConfirm(n)) return true;
  const total = n + countVisibleWrRoutes();
  const v = await askChoice({
    title: `Mostrar ${total} rutas`,
    message: `Con todos sus paraderos son miles de puntos y el mapa puede volverse lento. Puedes activarlos después en "Mostrar paradas"${FLAGS.beta ? ' (ajustes del mapa ⚙)' : ''}.`,
    choices: [
      { label: 'Mostrar sin paraderos', value: 'nostops', primary: true },
      { label: 'Mostrar con paraderos', value: 'stops' },
      { label: 'Cancelar', value: 'cancel' }
    ],
    cancelValue: 'cancel'
  });
  if (v === 'cancel') return false;
  if (v === 'nostops') setShowStops(false);
  return true;
}
