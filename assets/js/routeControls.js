// DOM adapter for commands addressed by service identity.
import { routeSelection } from './selectionState.js';
const projecting = new WeakSet();
export const isProjectingSelection = leaf => projecting.has(leaf);
export function leafForService(system, id){
  return document.querySelector(`#panels .item .item-head input[data-system="${CSS.escape(system)}"][data-id="${CSS.escape(String(id))}"]`);
}

routeSelection.subscribe(({ after, context }) => {
  const leaf = context.leaf || leafForService(after.system, after.id);
  if (!leaf) return;
  leaf.checked = after.selected;
  if (leaf.dataset.ida && leaf.dataset.vuelta) leaf.dataset.sel = after.direction;
  leaf.closest('.item')?.querySelectorAll('.dir-mini [data-dir]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.dir === after.direction));
  if (context.source === 'command'){
    projecting.add(leaf);
    try { leaf.dispatchEvent(new Event('change', { bubbles: true })); }
    finally { projecting.delete(leaf); }
  }
});

export function setRouteSelected(system, id, selected, { fit = true } = {}){
  return routeSelection.update(system, id, { selected }, { source: 'command', fit });
}
export function setControlSelected(leaf, selected, { fit = true } = {}){
  if (!leaf) return false;
  const { system, id } = leaf.dataset;
  return routeSelection.update(system, id, {
    selected, direction: leaf.dataset.sel || routeSelection.get(system, id).direction
  }, { source: 'command', fit, leaf });
}

export function registerRouteControls(){
  document.querySelectorAll('#panels .item .item-head input[data-system]').forEach(leaf => {
    if (leaf.dataset.sel) routeSelection.update(leaf.dataset.system, leaf.dataset.id,
      { direction: leaf.dataset.sel }, { source: 'hydrate', leaf });
  });
}
