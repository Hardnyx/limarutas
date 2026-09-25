// uiSidebar.js
// Fachada: re-exporta funciones desde módulos por sistema.

export { fillMetList, fillAlimList, fillMetroList } from './uiSidebar.systems.js';
export { fillCorrList } from './uiSidebar.corr.js';
export { fillWrList, fillAeroList, fillOtrosList, fillSemiformalList } from './uiSidebar.wr.js';
export { wireWrColorFilter } from './uiSidebar.wrColorFilter.js';

export {
  bulk,
  setLeafChecked,
  setGroupChecked,
  leavesOfGroup,
  syncTriFromLeaf,
  syncAllTri,
  clearAllRoutes,
  wireHierarchy
} from './uiSidebar.hierarchy.js';
