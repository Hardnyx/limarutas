// Editor history is isolated from the public map's selection and planner state.
export class RouteEditorState {
  constructor(){ this.reset(); }
  reset(){ this.pack = null; this.past = []; this.future = []; this.saved = null; this.persistedRevision = 0; this.dirty = false; }
  load(pack){ this.reset(); this.pack = structuredClone(pack); this.saved = structuredClone(pack); this.persistedRevision = pack.route.revision; }
  change(pack){
    if (this.pack) this.past.push(structuredClone(this.pack));
    if (this.past.length > 50) this.past.shift();
    this.pack = structuredClone(pack); this.pack.route.review.accepted = false;
    this.future = []; this.dirty = true;
  }
  undo(){ if (!this.past.length) return; this.future.push(this.pack); this.pack = this.past.pop(); this.dirty = true; }
  redo(){ if (!this.future.length) return; this.past.push(this.pack); this.pack = this.future.pop(); this.dirty = true; }
  markSaved(pack){ this.pack = structuredClone(pack); this.saved = structuredClone(pack); this.persistedRevision = pack.route.revision; this.dirty = false; }
  cancel(){ if (this.saved) this.pack = structuredClone(this.saved); this.past = []; this.future = []; this.dirty = false; }
  requestRoute(){ const route = structuredClone(this.pack.route); route.revision = this.persistedRevision; return route; }
}
