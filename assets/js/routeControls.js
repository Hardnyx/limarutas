// DOM adapter for commands addressed by service identity.
export function leafForService(system, id){
  return document.querySelector(`#panels .item .item-head input[data-system="${CSS.escape(system)}"][data-id="${CSS.escape(String(id))}"]`);
}
