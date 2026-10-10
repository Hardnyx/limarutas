import { state } from './config.js';
import { loadWrListaMeta } from './wrData.js';
import { createServiceCatalog } from './serviceCatalog.js';

// Rebuild on demand so catalog configuration changes are reflected explicitly.
export async function loadServiceCatalog(){
  return createServiceCatalog({ systems: state.systems, catalog: state.catalog,
    corridors: state.corrWr?.services || [], metadata: await loadWrListaMeta() });
}
