import { fitTo } from './mapFit.js';
import { getMetMacroId } from './mapLayers.js';
import { walkCached, walkRoute } from './walkRoute.js';
import { colorOf } from './tripPresentation.js';
const LINE_PANE = 'tripLinePane';
const MARK_PANE = 'tripMarkPane';

export function createTripMapRenderer(model, { state, pickedPoint, syncInputs, replan }){
  const { ends } = model;
  let tripLayer = null;
  const pins = { from: null, to: null };
  const stopName = i => model.graph.stops.name[i] || 'paradero';
  function addPin(end){
    const p = ends[end];
    if (!p) return;
    const icon = L.divIcon({ className: `trip-pin trip-pin-${end}`, html: end === 'from' ? 'A' : 'B', iconSize: [28, 28], iconAnchor: [14, 14] });
    const m = L.marker([p.lat, p.lon], { icon, draggable: true, pane: MARK_PANE, keyboard: false, title: end === 'from' ? 'Origen' : 'Destino' }).addTo(state.map);
    m.on('dragend', async () => {
      const ll = m.getLatLng();
      ends[end] = await pickedPoint(ll.lat, ll.lng);
      m.setLatLng([ends[end].lat, ends[end].lon]);
      syncInputs();
      void replan();
    });
    pins[end] = m;
  }

  function removePin(end){
    if (pins[end]){ pins[end].remove(); pins[end] = null; }
  }

  const tracks = new Map();
  function loadTrack(key){
    if (tracks.has(key)) return tracks.get(key);
    const def = state.systems.wr.routeDefs?.get(key);
    const p = !def ? Promise.resolve(null)
      : fetch(`${def.folder}/route_track_trip${def.trip || 1}${def.osm ? '.osm' : ''}.geojson`)
        .then(r => (r.ok ? r.json() : null))
        .then(gj => {
          const f = gj?.features?.find(x => x.geometry?.type === 'LineString');
          return f ? f.geometry.coordinates.map(([lo, la]) => [la, lo]) : null;
        })
        .catch(() => null);
    tracks.set(key, p);
    return p;
  }

  const d2 = (a, b) => (a[0] - b[0]) ** 2 + ((a[1] - b[1]) * 0.978) ** 2;
  function nearestIdx(line, p, from = 0){
    let best = -1, bd = Infinity;
    for (let i = from; i < line.length; i++){
      const d = d2(line[i], p);
      if (d < bd){ bd = d; best = i; }
    }
    return [best, bd];
  }

  // Tramo del trazo entre el paradero de subida y el de bajada; si el trazo no
  // está cargado o no calza (~150 m), línea entre paraderos
  const loadedTracks = new Map();

  // Metropolitano: el tramo por su trazado sobre la vía (metropolitano_paths.json)
  // entre la estación de subida y la de bajada; si no está, por la macroruta
  function metCoords(r, stops, leg){
    const m = r.key.match(/^met:(.+):(ns|sn)$/);
    const path = m && state.systems.met.paths?.[`${m[1]}:${m[2]}`];
    if (path && path.at.length === r.stops.length){
      return path.coords.slice(path.at[leg.from], path.at[leg.to] + 1);
    }
    const svc = m && state.systems.met.services?.find(x => String(x.id) === m[1]);
    const def = svc && state.systems.met.macros?.[getMetMacroId(svc)];
    const segs = def && def[m[2] === 'ns' ? 'north_south' : 'south_north'];
    if (!segs?.length) return stops;
    const line = segs.flat();
    const TOL = (300 / 111_000) ** 2;
    const [i, di] = nearestIdx(line, stops[0]);
    const [j, dj] = nearestIdx(line, stops[stops.length - 1]);
    if (i < 0 || j < 0 || di > TOL || dj > TOL || i === j) return stops;
    const part = i < j ? line.slice(i, j + 1) : line.slice(j, i + 1).reverse();
    return [stops[0], ...part, stops[stops.length - 1]];
  }

  function rideCoords(r, leg, pt){
    const stops = Array.from(r.stops.slice(leg.from, leg.to + 1), pt);
    if (r.group === 'metropolitano') return metCoords(r, stops, leg);
    if (r.group === 'alimentador'){
      // Por su trazado entre el paradero de subida y el de bajada
      const m = r.key.match(/^alim:(.+):(ida|vuelta)$/);
      const d = m && state.systems.alim.paths?.[m[1]]?.[m[2]];
      if (d && d.stops.length === r.stops.length) return d.coords.slice(d.stops[leg.from].at, d.stops[leg.to].at + 1);
      return stops;
    }
    const line = loadedTracks.get(r.key);
    if (!line) return stops;
    const TOL = (150 / 111_000) ** 2;
    const [i, di] = nearestIdx(line, stops[0]);
    const [j, dj] = nearestIdx(line, stops[stops.length - 1], Math.max(0, i));
    if (i < 0 || j <= i || di > TOL || dj > TOL) return stops;
    return [stops[0], ...line.slice(i, j + 1), stops[stops.length - 1]];
  }

  async function drawWithTracks(){
    const opt = model.result?.options?.[model.selected];
    if (!opt) return;
    // Metro, Metropolitano y Alimentadores tienen su propio trazado
    const keys = opt.legs.filter(l => l.type === 'ride' && !/^(met|metro|alim):/.test(l.route.key)).map(l => l.route.key);
    const missing = keys.filter(k => !loadedTracks.has(k));
    if (!missing.length) return;
    const lines = await Promise.all(missing.map(loadTrack));
    // También los que no tienen trazado (null): si no, se volvería a dibujar sin fin
    missing.forEach((k, i) => loadedTracks.set(k, lines[i]));
    if (model.result?.options?.[model.selected] === opt) draw({ fit: false });
  }

  function draw({ fit = true } = {}){
    if (!tripLayer) tripLayer = L.layerGroup().addTo(state.map);
    tripLayer.clearLayers();
    const opt = model.result?.options?.[model.selected];
    if (!opt) return;
    const { lat, lon } = model.graph.stops;
    const pt = i => [lat[i], lon[i]];
    const all = [];
    // Tramos a pie: por las calles si ya se tiene el camino (walkRoute.js); si
    // no, en recta mientras llega
    const missingWalks = [];
    const walk = (a, b) => {
      const w = walkCached(a, b);
      if (w === undefined) missingWalks.push([a, b]);
      const line = w ? w.coords : [a, b];
      tripLayer.addLayer(L.polyline(line, { pane: LINE_PANE, color: '#64748b', weight: 4, dashArray: '2 8', lineCap: 'round', interactive: false }));
      all.push(a, b);
    };

    let prev = [ends.from.lat, ends.from.lon];
    opt.legs.forEach((leg, k) => {
      if (leg.type === 'walk'){
        const next = k === opt.legs.length - 1 ? [ends.to.lat, ends.to.lon] : pt(leg.to);
        const start = leg.from != null ? pt(leg.from) : prev;
        walk(start, next);
        prev = next;
        return;
      }
      const r = leg.route;
      const coords = rideCoords(r, leg, pt);
      const color = colorOf(r);
      tripLayer.addLayer(L.polyline(coords, { pane: LINE_PANE, className: 'trip-route-outline', color: '#334155', weight: 12, opacity: 0.8, interactive: false }));
      tripLayer.addLayer(L.polyline(coords, { pane: LINE_PANE, color: '#fff', weight: 10, opacity: 0.9, interactive: false }));
      tripLayer.addLayer(L.polyline(coords, { pane: LINE_PANE, color, weight: 6, interactive: false }));
      // Cada paradero del tramo, con su nombre; los de subida y bajada más grandes
      for (let k = leg.from; k <= leg.to; k++){
        const end = k === leg.from || k === leg.to;
        const stop = r.stops[k];
        tripLayer.addLayer(L.circleMarker(pt(stop), {
          // Subida y bajada bien marcadas; las intermedias, discretas (del color de la ruta)
          pane: MARK_PANE, radius: end ? 6.5 : 2.5, color: end ? color : '#fff', weight: end ? 3.5 : 1,
          fillColor: end ? '#fff' : color, fillOpacity: 1, bubblingMouseEvents: false
        }).bindTooltip(end ? `${k === leg.from ? 'Sube' : 'Baja'} en ${stopName(stop)}` : stopName(stop),
          { className: 'stop-tip', direction: 'top', offset: [0, -6] }));
      }
      all.push(...coords);
      prev = coords[coords.length - 1];
    });
    if (fit && all.length) fitTo(L.latLngBounds(all));
    void drawWithTracks();
    if (missingWalks.length){
      Promise.all(missingWalks.map(([a, b]) => walkRoute(a, b))).then(res => {
        if (res.some(Boolean) && model.result?.options?.[model.selected] === opt) draw({ fit: false });
      });
    }
  }

  function mount(){
    [[LINE_PANE, 480], [MARK_PANE, 640]].forEach(([name, z]) => {
      if (!state.map.getPane(name)) state.map.createPane(name).style.zIndex = String(z);
    });
  }
  return { mount, draw, addPin, removePin, clear: () => tripLayer?.clearLayers() };
}
