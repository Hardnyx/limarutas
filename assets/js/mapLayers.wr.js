// mapLayers.wr.js
// Capas de Wikiroutes: carga diferida (con límite de concurrencia),
// visibilidad por subcapa (ida/vuelta) y paraderos.
import { state } from './config.js';
import { buildWikiroutesLayer } from './parsers.js';
import { wireStopLayer } from './stopHover.js';
import { PANES } from './mapPanes.js';
import { fitTo, currentFitBatch, addBoundsToBatch } from './mapFit.js';
import { CORR_FALLBACK, forceStroke, isCorrLikeWrId, corrColorForWrId } from './mapColors.js';

/* ===========================
   Wikiroutes con viajes (lazy)
   =========================== */

// Rutas WR dibujadas ahora mismo en el mapa
export function countVisibleWrRoutes(){
  const wr = state.systems.wr;
  let n = 0;
  wr.layers?.forEach(g => { if (state.map.hasLayer(g)) n++; });
  return n;
}

// Paradas WR on/off según visibilidad de cada subcapa
export function syncOneWrStopsVisibility(id){
  const wr = state.systems.wr;
  const g = wr.layers?.get(id);
  const stopSub = wr.stopLayers?.get(id);
  if (!stopSub) return;

  const routeVisible = g && state.map.hasLayer(g);
  const shouldShowStops = routeVisible && state.showStops;

  if (shouldShowStops) {
    if (!state.map.hasLayer(stopSub)) stopSub.addTo(state.map);
  } else {
    if (state.map.hasLayer(stopSub)) state.map.removeLayer(stopSub);
  }
}

function wrBaseId(id){
  return String(id).replace(/-(ida|vuelta)$/i, '');
}

function wrCounterpartId(id){
  const s = String(id);
  if (/-ida$/i.test(s)) return s.replace(/-ida$/i, '-vuelta');
  if (/-vuelta$/i.test(s)) return s.replace(/-vuelta$/i, '-ida');
  return null;
}

function wrHasDefOrLayer(id){
  const wr = state.systems.wr;
  return !!(wr.layers?.has(id) || wr.routeDefs?.has(id));
}

// Límite de capas WR cargándose a la vez: con cientos de rutas marcadas,
// lanzar todas las peticiones juntas hace que el servidor corte algunas.
const WR_MAX_CONCURRENT_BUILDS = 12;
let wrActiveBuilds = 0;
const wrBuildQueue = [];

async function withWrBuildSlot(fn){
  if (wrActiveBuilds >= WR_MAX_CONCURRENT_BUILDS){
    await new Promise(res => wrBuildQueue.push(res));
  }
  wrActiveBuilds++;
  try { return await fn(); }
  finally {
    wrActiveBuilds--;
    const next = wrBuildQueue.shift();
    if (next) next();
  }
}

async function ensureWrLayer(id){
  const wr = state.systems.wr;

  if (wr.layers?.has(id)) return true;

  const def = wr.routeDefs?.get(id);
  if (!def) return false;

  if (!wr._buildPromises) wr._buildPromises = new Map();

  if (!wr._buildPromises.has(id)) {
    const p = (async () => {
      // Si el ID WR parece un corredor (101, 301, SE-02, SP-01, COLE BUS),
      // sobreescribe el color al del corredor.
      const autoColor = isCorrLikeWrId(id) ? corrColorForWrId(id) : null;
      const colorToUse = autoColor && autoColor !== CORR_FALLBACK ? autoColor : def.color;

      await withWrBuildSlot(() => {
        // Si se desmarcó mientras esperaba turno, no descargar nada
        if (wr._wanted?.get(id) === false) return null;
        return buildWikiroutesLayer(String(id), def.folder, { color: colorToUse, trip: def.trip, stopPane: PANES.stop });
      });

      // Nombre del paradero al pasar el mouse
      wr.stopLayers?.get(id)?.eachLayer(wireStopLayer);

      // Post-fix: si el layer quedó en SVG y algo pisó el stroke, forzar.
      const g = wr.layers?.get(id);
      if (g && g.eachLayer && isCorrLikeWrId(id) && colorToUse) {
        try {
          g.eachLayer(sub => {
            if (sub && typeof sub.setStyle === 'function') {
              try { sub.setStyle({ color: colorToUse }); } catch {}
            }
            forceStroke(sub, colorToUse);
            if (sub && typeof sub.eachLayer === 'function') {
              sub.eachLayer(ch => {
                if (ch && typeof ch.setStyle === 'function') {
                  try { ch.setStyle({ color: colorToUse }); } catch {}
                }
                forceStroke(ch, colorToUse);
              });
            }
          });
        } catch {}
      }
    })()
      .catch(e => {
        console.warn('[WR] No se pudo construir capa', id, e?.message || e);
      })
      .finally(() => {
        try { wr._buildPromises.delete(id); } catch {}
      });

    wr._buildPromises.set(id, p);
  }

  await wr._buildPromises.get(id);
  return wr.layers?.has(id);
}

// Visibilidad deseada por subcapa: evita que una capa que termina de cargar
// después de desmarcarse se agregue igual al mapa.
function setWrWanted(id, visible){
  const wr = state.systems.wr;
  if (!wr._wanted) wr._wanted = new Map();
  wr._wanted.set(id, visible);
}

function hideWrSub(id){
  const wr = state.systems.wr;
  setWrWanted(id, false);
  const g = wr.layers?.get(id);
  if (g && state.map.hasLayer(g)) state.map.removeLayer(g);

  const stopSub = wr.stopLayers?.get(id);
  if (stopSub && state.map.hasLayer(stopSub)) state.map.removeLayer(stopSub);
}

async function showWrSubAsync(id, fit){
  const wr = state.systems.wr;

  // Exclusión automática por convención -ida/-vuelta
  const other = wrCounterpartId(id);
  if (other) hideWrSub(other);

  setWrWanted(id, true);
  const ok = await ensureWrLayer(id);
  if (!ok) return;
  if (wr._wanted.get(id) !== true) return;

  const g = wr.layers?.get(id);
  if (!g) return;

  if (!state.map.hasLayer(g)) g.addTo(state.map);
  syncOneWrStopsVisibility(id);

  if (fit && wr.bounds?.get(id) && state.autoFit) fitTo(wr.bounds.get(id).pad(0.04));
}

function showWrSub(id, fit){
  const p = showWrSubAsync(id, fit);
  const batch = currentFitBatch();
  if (!batch) return;
  const wr = state.systems.wr;
  batch.pending.push(p.then(() => {
    if (wr._wanted?.get(id) === true) addBoundsToBatch(batch, wr.bounds?.get(id));
  }));
}

// Resolver ida/vuelta desde el DOM si existe, con fallback por convención
function resolveWrPair(id){
  const wr = state.systems.wr;
  const root = document.getElementById('p-wr');

  const hasPairData = (el) => !!(el && (el.dataset.ida || el.dataset.vuelta));

  const s = String(id);
  const base = wrBaseId(s);

  if (root) {
    const pick = (pid) =>
      root.querySelector(`.item input[type="checkbox"][data-id="${pid}"]`);

    const leafExact = pick(s);
    if (hasPairData(leafExact)) {
      return {
        parentId: s,
        ida: leafExact.dataset.ida || null,
        vuelta: leafExact.dataset.vuelta || null,
        sel: leafExact.dataset.sel || 'ida',
        leaf: leafExact
      };
    }

    const leafBase = pick(base);
    if (hasPairData(leafBase)) {
      return {
        parentId: base,
        ida: leafBase.dataset.ida || null,
        vuelta: leafBase.dataset.vuelta || null,
        sel: leafBase.dataset.sel || 'ida',
        leaf: leafBase
      };
    }
  }

  // Si el id no tiene sufijo ida/vuelta, buscar si existe -ida o -vuelta directamente
  if (base === s) {
    const idaKey    = `${s}-ida`;
    const vueltaKey = `${s}-vuelta`;
    if (wrHasDefOrLayer(idaKey) || wrHasDefOrLayer(vueltaKey)) {
      return {
        parentId: s,
        ida:    wrHasDefOrLayer(idaKey)    ? idaKey    : null,
        vuelta: wrHasDefOrLayer(vueltaKey) ? vueltaKey : null,
        sel:    'ida',
        leaf:   null
      };
    }
  }

  // Fallback por convención si el id parece subcapa
  if (base !== s) {
    const ida    = `${base}-ida`;
    const vuelta = `${base}-vuelta`;
    const sel    = /-vuelta$/i.test(s) ? 'vuelta' : 'ida';

    if (wrHasDefOrLayer(ida) || wrHasDefOrLayer(vuelta)) {
      return { parentId: base, ida, vuelta, sel, leaf: null };
    }
  }

  return null;
}

function applyWrPairVisibility(pair, checked, fit){
  const showId  = pair.sel === 'vuelta' ? pair.vuelta : pair.ida;
  const otherId = pair.sel === 'vuelta' ? pair.ida   : pair.vuelta;

  if (checked) {
    if (otherId) hideWrSub(otherId);
    if (showId)  showWrSub(showId, fit);
  } else {
    if (pair.ida) hideWrSub(pair.ida);
    if (pair.vuelta) hideWrSub(pair.vuelta);
  }
}

// API pública: acepta id real (subcapa) o id padre
export function setWikiroutesVisible(id, visible, { fit=false } = {}){
  const wr = state.systems.wr;

  // 1) Si es una subcapa real (ya construida) o definida (lazy), actúa directo.
  if (wrHasDefOrLayer(id)) {
    if (visible) showWrSub(id, fit);
    else hideWrSub(id);
    return;
  }

  // 2) Si es un "padre" Ida/Vuelta, usa el par (DOM o convención)
  const pair = resolveWrPair(id);
  const pairValid =
    pair &&
    ((pair.ida && wrHasDefOrLayer(pair.ida)) || (pair.vuelta && wrHasDefOrLayer(pair.vuelta)));

  if (pairValid) {
    applyWrPairVisibility(pair, visible, fit);
  }
}
