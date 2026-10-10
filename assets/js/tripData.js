// Application loader; graph assembly never reads UI controls.
import { loadServiceCatalog } from './catalogRepository.js';
import { buildTripGraph } from './tripGraph.js';
export { buildTripGraph, WALK_MAX_M } from './tripGraph.js';
export { distM } from './geo.js';
export { TRIP_GROUPS } from './serviceCatalog.js';
const GRAPH_URL = 'pipeline/output/trip_graph.json';
let graphPromise = null;
export function loadTripGraph({ force = false } = {}){
  if (force) graphPromise = null;
  if (!graphPromise){
    graphPromise = Promise.all([
      fetch(GRAPH_URL).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} - ${GRAPH_URL}`); return r.json(); }),
      loadServiceCatalog()
    ]).then(([raw, catalog]) => buildTripGraph(raw, catalog))
      .catch(err => { graphPromise = null; throw err; });
  }
  return graphPromise;
}
