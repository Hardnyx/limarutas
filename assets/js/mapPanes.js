// mapPanes.js
// Panes de Leaflet para el orden de dibujo entre sistemas.
import { state } from './config.js';

/* ===========================
   Panes (orden de dibujo)
   =========================== */

export const PANES = {
  // Wikiroutes (transporte general) se queda en el overlayPane por defecto (zIndex 400)
  alimLine: 'alimLinePane',
  corrLine: 'corrLinePane',
  metroLine: 'metroLinePane',
  metLine: 'metLinePane',
  metTopLine: 'metTopLinePane',

  stop: 'stopPane',
  metTopStop: 'metTopStopPane'
};

const Z = {
  // overlayPane default ~400. Ponemos capas "prioritarias" por encima.
  alimLine: 430,
  corrLine: 440,
  metroLine: 450,
  metLine: 460,
  metTopLine: 470,

  // markerPane default ~600. Creamos panes propios ligeramente arriba.
  stop: 610,
  metTopStop: 620
};

function ensurePane(map, name, zIndex){
  if (map.getPane(name)) return;
  const p = map.createPane(name);
  p.style.zIndex = String(zIndex);
}

export function ensureCustomPanes(){
  const map = state.map;
  ensurePane(map, PANES.alimLine, Z.alimLine);
  ensurePane(map, PANES.corrLine, Z.corrLine);
  ensurePane(map, PANES.metroLine, Z.metroLine);
  ensurePane(map, PANES.metLine, Z.metLine);
  ensurePane(map, PANES.metTopLine, Z.metTopLine);

  ensurePane(map, PANES.stop, Z.stop);
  ensurePane(map, PANES.metTopStop, Z.metTopStop);
}

export function getLinePane(systemId, svc){
  if (systemId === 'met'){
    const idU = String(svc?.id ?? '').toUpperCase();
    if (idU === 'B' || idU === 'C') return PANES.metTopLine;
    return PANES.metLine;
  }
  if (systemId === 'metro') return PANES.metroLine;
  if (systemId === 'corr') return PANES.corrLine;
  if (systemId === 'alim') return PANES.alimLine;
  return undefined; // WR y otros: pane por defecto
}

export function getStopPane(systemId, svc){
  if (systemId === 'met'){
    const idU = String(svc?.id ?? '').toUpperCase();
    if (idU === 'B' || idU === 'C') return PANES.metTopStop;
  }
  return PANES.stop;
}
