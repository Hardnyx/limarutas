// routeEntries.js
// Qué rutas hay en un punto del mapa (o en un paradero) y cómo se describen:
// código, color, título, subtítulo y su casilla del sidebar. Lo usan el
// panel "Rutas en este punto" y el buscador.
import { state, SYSTEM_LABELS } from './config.js';

const TOLERANCE_PX = 6;

// Listas del sidebar con rutas de Wikiroutes, en orden de preferencia
const WR_SYSTEMS = ['wr', 'corr', 'wrAero', 'wrOtros', 'wrSemi'];

/* =========================
   Detección de líneas bajo el cursor
   ========================= */

export function polylinesOf(layer, out = []){
  if (!layer) return out;
  if (layer instanceof L.Polyline) out.push(layer);
  else if (typeof layer.eachLayer === 'function') layer.eachLayer(l => polylinesOf(l, out));
  return out;
}

// Distancia en px del punto a la polilínea ya proyectada por Leaflet (_parts)
function hits(poly, p){
  if (!poly._map || !poly._parts || !poly._pxBounds) return false;
  const b = poly._pxBounds;
  if (p.x < b.min.x - TOLERANCE_PX || p.x > b.max.x + TOLERANCE_PX ||
      p.y < b.min.y - TOLERANCE_PX || p.y > b.max.y + TOLERANCE_PX) return false;
  for (const part of poly._parts){
    for (let i = 1; i < part.length; i++){
      if (L.LineUtil.pointToSegmentDistance(p, part[i - 1], part[i]) <= TOLERANCE_PX) return true;
    }
  }
  return false;
}

// Índice de las casillas del sidebar (se arma una vez: la lista no cambia)
let leafIndex = null;
function leaves(){
  if (!leafIndex){
    leafIndex = new Map();
    document.querySelectorAll('#panels .item .item-head input[type="checkbox"][data-system]').forEach(chk => {
      const { system, id, ida, vuelta } = chk.dataset;
      if (ida && !leafIndex.has(`pair:${ida}`)) leafIndex.set(`pair:${ida}`, chk);
      if (vuelta && !leafIndex.has(`pair:${vuelta}`)) leafIndex.set(`pair:${vuelta}`, chk);
      if (id && !leafIndex.has(`${system}:${id}`)) leafIndex.set(`${system}:${id}`, chk);
    });
  }
  return leafIndex;
}

// Ítem del sidebar de una subcapa WR ("1002-ida", "AD-N-vuelta", ...)
export function wrLeafFor(subId){
  const idx = leaves();
  const byPair = idx.get(`pair:${subId}`);
  if (byPair) return byPair;
  // Por código solo dentro de listas de Wikiroutes: "6" no es el Expreso 6
  const base = String(subId).replace(/-(ida|vuelta)$/i, '');
  for (const sys of WR_SYSTEMS){
    const leaf = idx.get(`${sys}:${base}`);
    if (leaf) return leaf;
  }
  return null;
}

function wrEntry(subId, polys){
  const leaf = wrLeafFor(subId);
  const item = leaf?.closest('.item');
  const tag = item?.querySelector('.item-head .left .tag');
  const title = item?.querySelector('.item-head .name')?.textContent?.trim() || '';

  // Distritos (dicen más que un paradero); si no hay, los paraderos extremos
  const dist = item?.querySelector('.wr-subtitle-dist')?.textContent?.trim();
  const subs = item ? item.querySelectorAll('.item-head .sub') : [];
  const route = (item?.querySelector('.wr-subtitle-route')?.textContent
    || subs[subs.length - 1]?.textContent || '').trim();

  return {
    key: `wr:${subId}`,
    code: tag?.textContent?.trim() || String(subId).replace(/-(ida|vuelta)$/i, '').toUpperCase(),
    color: tag?.style.background || polys[0]?.options.color || '#64748b',
    title,
    sub: (dist && dist !== title) ? dist : route,
    system: SYSTEM_LABELS[leaf?.dataset.system] || SYSTEM_LABELS.wr,
    leaf,
    polys
  };
}

function serviceEntry(sysId, id, polys){
  const svc = state.systems[sysId]?.services?.find(s => String(s.id) === String(id));
  const leaf = leaves().get(`${sysId}:${id}`) || null;
  const code = String(id).toUpperCase();
  return {
    key: `${sysId}:${id}`,
    code,
    color: polys[0]?.options.color || svc?.color || '#64748b',
    title: svc?.name || `${SYSTEM_LABELS[sysId]} ${code}`,
    sub: '',
    system: SYSTEM_LABELS[sysId],
    leaf,
    polys
  };
}

// Subcapas WR (rid "1240-ida", ...) por carpeta de Wikiroutes ("155549")
let ridsByFolder = null;
function ridsForFolder(folderId){
  if (!ridsByFolder){
    ridsByFolder = new Map();
    state.systems.wr.routeDefs?.forEach((def, rid) => {
      const m = String(def.folder || '').match(/route_(\d+)$/);
      if (!m) return;
      if (!ridsByFolder.has(m[1])) ridsByFolder.set(m[1], []);
      ridsByFolder.get(m[1]).push(rid);
    });
  }
  return ridsByFolder.get(String(folderId)) || [];
}

// Una entrada por ítem del sidebar (ida y vuelta comparten ítem)
export function entriesForFolders(folderIds){
  const key = folderIds.join(',');
  const cached = entriesCache.get(key);
  if (cached) return cached.map(e => ({ ...e, polys: currentPolys(e.rid) }));
  const out = buildEntriesForFolders(folderIds);
  entriesCache.set(key, out);
  return out;
}

const entriesCache = new Map();

function currentPolys(rid){
  const group = state.systems.wr.layers?.get(rid);
  return group ? polylinesOf(group) : [];
}

function buildEntriesForFolders(folderIds){
  const byLeaf = new Map();
  for (const fid of folderIds){
    for (const rid of ridsForFolder(fid)){
      const leaf = wrLeafFor(rid);
      if (!leaf || byLeaf.has(leaf)) continue;
      byLeaf.set(leaf, { ...wrEntry(rid, currentPolys(rid)), rid });
    }
  }
  return [...byLeaf.values()].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
}

export function findUnderPoint(layerPoint){
  const found = [];

  state.systems.wr.layers?.forEach((group, id) => {
    if (!state.map.hasLayer(group)) return;
    const polys = polylinesOf(group);
    if (polys.some(pl => hits(pl, layerPoint))) found.push(wrEntry(id, polys));
  });

  for (const sysId of ['met', 'alim', 'corr', 'metro']){
    state.systems[sysId]?.lineLayers?.forEach((group, id) => {
      const polys = polylinesOf(group);
      if (polys.some(pl => hits(pl, layerPoint))) found.push(serviceEntry(sysId, id, polys));
    });
  }

  return found.sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
}
