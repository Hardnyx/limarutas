export const selectionKey = (system, id) => `${system}:${String(id).toUpperCase()}`;
const defaultDirection = system => system === 'alim' ? 'sur' : system.startsWith('wr') ? 'ida' : 'ambas';

// Serializable service state; subscribers own all map and DOM effects.
export function createSelectionState(){
  const records = new Map(), listeners = new Set();
  const get = (system, id) => records.get(selectionKey(system, id)) ||
    { system, id: String(id), selected: false, direction: defaultDirection(system) };
  return {
    get,
    update(system, id, patch, context = {}){
      const before = get(system, id), after = { ...before, ...patch };
      if (before.selected === after.selected && before.direction === after.direction) return false;
      records.set(selectionKey(system, id), after);
      for (const listener of listeners) listener({ before, after, context });
      return true;
    },
    selected: () => [...records.values()].filter(r => r.selected).map(r => ({ ...r })),
    subscribe(listener){ listeners.add(listener); return () => listeners.delete(listener); }
  };
}
export const routeSelection = createSelectionState();
