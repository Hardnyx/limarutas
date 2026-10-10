// leafToggle.js
// Muestra u oculta en el mapa la ruta de una casilla del sidebar ("hoja").
// Único lugar que decide cómo se dibuja cada tipo de hoja; lo usan los
// clics en la lista, las casillas de grupo, el cambio de sentido y el
// buscador.
import { onToggleService, setWikiroutesVisible } from './mapLayers.js';
import { routeSelection } from './selectionState.js';
import { getDirFor } from './config.js';
import { leafForService, isProjectingSelection } from './routeControls.js';

// Tipos de hoja, según sus data-*:
//   data-ida + data-vuelta  → par Wikiroutes; se ve el sentido de data-sel
//   data-layer              → Wikiroutes de un solo sentido (id de la capa)
//   corr con id numérico    → capa Wikiroutes con ese id
//   resto                   → servicio del sistema (met, alim, metro, corr)
function renderLeaf(leaf, visible, { fit = false } = {}){
  if (!leaf) return;
  const { system, id, ida, vuelta, layer } = leaf.dataset;

  if (ida && vuelta){
    const sel = leaf.dataset.sel === 'vuelta' ? 'vuelta' : 'ida';
    const show  = sel === 'vuelta' ? vuelta : ida;
    const other = sel === 'vuelta' ? ida : vuelta;
    if (visible){
      setWikiroutesVisible(show, true, { fit });
      setWikiroutesVisible(other, false);
    } else {
      setWikiroutesVisible(ida, false);
      setWikiroutesVisible(vuelta, false);
    }
    return;
  }

  if (layer){
    setWikiroutesVisible(layer, visible, visible ? { fit } : {});
    return;
  }

  if (system === 'corr' && /^\d+$/.test(String(id))){
    setWikiroutesVisible(id, visible, visible ? { fit } : {});
    return;
  }

  if (system && system.startsWith('wr')){
    setWikiroutesVisible(id, visible, visible ? { fit } : {});
    return;
  }

  onToggleService(system, id, visible, { silentFit: !fit });
}

// The existing controls and bulk actions feed the same observable state.
export function toggleLeaf(leaf, visible, { fit = false } = {}){
  if (!leaf || isProjectingSelection(leaf)) return;
  const { system, id } = leaf.dataset;
  const direction = leaf.dataset.sel || getDirFor(system, id);
  const changed = routeSelection.update(system, id, { selected: visible, direction }, { source: 'control', fit, leaf });
  if (!changed && fit) renderLeaf(leaf, visible, { fit });
}
routeSelection.subscribe(({ before, after, context }) => {
  if (!before.selected && !after.selected) return;
  renderLeaf(context.leaf || leafForService(after.system, after.id), after.selected, { fit: !!context.fit });
});

// ¿La hoja dibuja una capa Wikiroutes? (con sus paraderos: las que pesan)
export function isWrLeaf(leaf){
  if (!leaf) return false;
  const { system, id, ida, vuelta, layer } = leaf.dataset;
  if ((ida && vuelta) || layer) return true;
  if (system === 'corr') return /^\d+$/.test(String(id));
  return !!(system && system.startsWith('wr'));
}

// Tras cambiar data-sel de una hoja ya marcada: mostrar el otro sentido
// sin mover la vista
export function refreshLeafDirection(leaf){
  if (leaf && leaf.checked) toggleLeaf(leaf, true, { fit: false });
}
