// uiSidebar.hierarchy.js
// Casillas de grupo (tri-estado) del sidebar.
//
// La jerarquía se lee del DOM: las hojas de una casilla de grupo son las
// casillas de ruta que están dentro de su sección (.panel). Así el
// anidamiento (Metropolitano → Alimentadores → Norte/Sur, Otros → Expreso
// San Isidro, Corredores → color → principales/alimentadoras) sale solo y
// los grupos que se reconstruyen (Corredores) no quedan desincronizados.
import { state } from './config.js';
import { $$ } from './utils.js';
import { beginFitBatch, endFitBatch } from './mapLayers.js';
import { toggleLeaf, isWrLeaf } from './leafToggle.js';
import { refreshRecents } from './recents.js';
import { confirmManyRoutes, manyRoutesNeedsConfirm } from './stopsGuard.js';

const GROUP_SEL = '#panels .panel-head > input[type="checkbox"]';
const LEAF_SEL  = '.item .item-head input[type="checkbox"]';
export const FILTERED_SEL = '.is-color-filtered, .is-text-filtered';
// Evento en document al terminar un cambio de rutas en lote
export const ROUTES_CHANGED = 'limarutas:routes-changed';

/* =========================
   Operaciones en lote
   ========================= */

// Encuadra al final el conjunto de rutas que se hayan mostrado en el lote
let bulkDepth = 0;
export function bulk(fn){
  bulkDepth++;
  state.bulk = true;
  beginFitBatch();
  try { fn(); } finally {
    if (--bulkDepth === 0) state.bulk = false;
    void endFitBatch();
    if (bulkDepth === 0){
      refreshRecents();
      // Las casillas de grupo cambian las hojas sin eventos 'change'
      document.dispatchEvent(new Event(ROUTES_CHANGED));
    }
  }
}

/* =========================
   Hojas
   ========================= */

// Hojas de una casilla de grupo; las ocultas por un filtro (color o texto) no cuentan
export function leavesOfGroup(groupChk){
  const panel = groupChk && groupChk.closest('.panel');
  if (!panel) return [];
  return Array.from(panel.querySelectorAll(LEAF_SEL))
    .filter(chk => !chk.closest(FILTERED_SEL));
}

export function setLeafChecked(systemId, leafChk, checked, { silentFit = false } = {}){ // eslint-disable-line no-unused-vars
  if (!leafChk) return;
  if (leafChk.checked === checked) return;
  leafChk.checked = checked;
  if (!leafChk.dataset.id) return;
  toggleLeaf(leafChk, checked, { fit: !silentFit });
}

/* =========================
   Grupos
   ========================= */

export function setGroupChecked(groupChk, checked){
  if (!groupChk) return;
  groupChk.checked = checked;
  groupChk.indeterminate = false;
  leavesOfGroup(groupChk).forEach(leaf =>
    setLeafChecked(leaf.dataset.system, leaf, checked, { silentFit: true }));
}

function syncGroup(groupChk){
  const leaves = leavesOfGroup(groupChk);
  const total = leaves.length;
  const checked = leaves.filter(c => c.checked).length;
  groupChk.indeterminate = checked > 0 && checked < total;
  groupChk.checked = total > 0 && checked === total;
}

export function syncAllTri(){
  $$(GROUP_SEL).forEach(syncGroup);
}

// Compatibilidad: los grupos se calculan desde el DOM, así que basta con
// sincronizar todos (son pocos)
export function syncTriFromLeaf(_systemId){ // eslint-disable-line no-unused-vars
  syncAllTri();
}

// Desmarca todas las rutas de todos los sistemas
export function clearAllRoutes(){
  bulk(() => {
    $$(`#panels ${LEAF_SEL}`).forEach(leaf =>
      setLeafChecked(leaf.dataset.system, leaf, false, { silentFit: true }));
  });
  syncAllTri();
}

/* =========================
   Wire
   ========================= */

function applyGroup(groupChk, v){
  bulk(() => setGroupChecked(groupChk, v));
  syncAllTri();
}

async function onGroupChange(groupChk){
  const v = groupChk.checked;
  // Solo cuentan las rutas Wikiroutes: son las que traen miles de paraderos
  const n = v ? leavesOfGroup(groupChk).filter(l => !l.checked && isWrLeaf(l)).length : 0;
  if (!v || !manyRoutesNeedsConfirm(n)){
    applyGroup(groupChk, v);
    return;
  }
  // Con muchas rutas nuevas se pregunta antes de dibujar; mientras el
  // diálogo está abierto la casilla muestra su estado real
  syncAllTri();
  if (await confirmManyRoutes(n)) applyGroup(groupChk, true);
}

// Un solo listener delegado: vale también para los grupos que se crean
// o reconstruyen después (Corredores)
export function wireHierarchy(){
  const panels = document.getElementById('panels');
  if (!panels || panels.dataset.hierarchyWired === '1') return;
  panels.dataset.hierarchyWired = '1';

  panels.addEventListener('change', (e) => {
    const chk = e.target;
    if (chk instanceof HTMLInputElement && chk.matches(GROUP_SEL)) onGroupChange(chk);
  });

  syncAllTri();
}
