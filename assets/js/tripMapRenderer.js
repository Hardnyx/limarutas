import { fitTo } from './mapFit.js';
import { getMetMacroId } from './mapLayers.js';
import { walkCached, walkRoute } from './walkRoute.js';
import { colorOf } from './tripPresentation.js';
import { durationText } from './tripTimeline.js';
import { el } from './utils.js';
import { icon } from './icons.js';
const LINE_PANE = 'tripLinePane';
const MARK_PANE = 'tripMarkPane';
const ALT_PANE = 'tripAlternativePane';
const LABEL_PANE = 'tripChoicePane';

export function createTripMapRenderer(model, { state, pickedPoint, syncInputs, replan, onSelect }){
  const { ends } = model;
  let tripLayer = null;
  let choiceLayer = null;
  let choiceLines = [];
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
    const def = svc && state.systems.met.macros?.[getMetMacroId(svc, m[2])];
    const segs = def && def[m[2] === 'ns' ? 'north_south' : 'south_north'];
    if (!segs?.length) return [];
    const line = segs.flat();
    const TOL = (300 / 111_000) ** 2;
    const [i, di] = nearestIdx(line, stops[0]);
    const [j, dj] = nearestIdx(line, stops[stops.length - 1]);
    if (i < 0 || j < 0 || di > TOL || dj > TOL || i === j) return [];
    const part = i < j ? line.slice(i, j + 1) : line.slice(j, i + 1).reverse();
    return part;
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
    const result = model.result;
    const options = result?.options || [];
    const keys = [...new Set(options.flatMap(opt => opt.legs.filter(l => l.type === 'ride' && !/^(met|metro|alim):/.test(l.route.key)).map(l => l.route.key)))];
    const missing = keys.filter(key => !loadedTracks.has(key));
    if (!missing.length) return;
    const lines = await Promise.all(missing.map(loadTrack));
    missing.forEach((key, i) => loadedTracks.set(key, lines[i]));
    if (model.result === result) draw({ fit: false });
  }

  function choiceLabels(){
    if (!choiceLayer) choiceLayer = L.layerGroup().addTo(state.map);
    choiceLayer.clearLayers();
    if (!model.result?.options.length || !choiceLines.length) return;
    const map = state.map, size = map.getSize();
    const sidebar = document.getElementById('sidebar');
    const left = state.mapInsets || document.documentElement.classList.contains('sidebar-collapsed') ? 12 : (sidebar?.offsetWidth || 400) + 24;
    const bottom = size.y - (state.mapInsets?.bottom || 0) - 20;
    const boxes = [];
    // Place each label on its own itinerary, with the selected option first.
    const order = [model.selected, ...choiceLines.map((_, i) => i).filter(i => i !== model.selected)];
    for (const index of order){
      const line = choiceLines[index];
      if (!line?.length) continue;
      const projected = line.map(point => map.latLngToContainerPoint(point));
      const cumulative = [0];
      for (let i = 1; i < projected.length; i++) cumulative.push(cumulative[i - 1] + projected[i].distanceTo(projected[i - 1]));
      const total = cumulative[cumulative.length - 1];
      const pointAt = fraction => {
        const target = total * fraction;
        let i = cumulative.findIndex(length => length >= target);
        if (i < 1) return projected[0];
        const span = cumulative[i] - cumulative[i - 1];
        const share = span ? (target - cumulative[i - 1]) / span : 0;
        return L.point(projected[i - 1].x + (projected[i].x - projected[i - 1].x) * share,
          projected[i - 1].y + (projected[i].y - projected[i - 1].y) * share);
      };
      let chosen = null, fallback = null;
      const fractions = [.48, .32, .64, .2, .8, .4, .56, .12, .88];
      for (let attempt = 0; attempt < fractions.length; attempt++){
        const point = pointAt(fractions[(attempt + index) % fractions.length]);
        const box = { x: point.x - 70, y: point.y - 18, width: 140, height: 36 };
        if (box.x < left || box.x + box.width > size.x - 12 || box.y < 60 || box.y + box.height > bottom) continue;
        fallback ||= point;
        if (boxes.some(b => box.x < b.x + b.width + 8 && box.x + box.width + 8 > b.x && box.y < b.y + b.height + 8 && box.y + box.height + 8 > b.y)) continue;
        chosen = point; boxes.push(box); break;
      }
      chosen ||= fallback || pointAt(.25 + index * .1);
      const option = model.result.options[index];
      const button = el('button', { type: 'button', class: `trip-choice${index === model.selected ? ' selected' : ''}`,
        'data-option': String(index), 'aria-pressed': String(index === model.selected),
        'aria-label': `Alternativa ${index + 1}: ${durationText(option.minutes)}` });
      const modes = el('span', { class: 'trip-choice-modes', 'aria-hidden': 'true' });
      option.legs.filter(leg => leg.type === 'ride').forEach((leg, i) => {
        if (i) modes.append('›');
        modes.append(icon(leg.route.group === 'metro' ? 'subway' : 'bus'));
      });
      button.append(modes, el('span', {}, durationText(option.minutes)));
      L.DomEvent.disableClickPropagation(button);
      button.addEventListener('click', () => onSelect(index));
      choiceLayer.addLayer(L.marker(map.containerPointToLatLng(chosen), {
        pane: LABEL_PANE, keyboard: false, bubblingMouseEvents: false,
        icon: L.divIcon({ className: 'trip-choice-marker', html: button, iconSize: [140, 36], iconAnchor: [70, 18] })
      }));
    }
  }

  function draw({ fit = true, fitAll = false } = {}){
    if (!tripLayer) tripLayer = L.layerGroup().addTo(state.map);
    tripLayer.clearLayers();
    choiceLayer?.clearLayers(); choiceLines = [];
    const result = model.result;
    if (result?.walkOnly){
      const a = [ends.from.lat, ends.from.lon], b = [ends.to.lat, ends.to.lon];
      const path = walkCached(a, b);
      tripLayer.addLayer(L.polyline(path?.coords || [a, b], { pane: LINE_PANE, className: 'trip-walk-only', color: '#64748b', weight: 4, dashArray: '2 8', interactive: false }));
      if (fit) fitTo(L.latLngBounds([a, b]));
      if (path === undefined) void walkRoute(a, b).then(route => { if (route && model.result === result) draw({ fit: false }); });
      return;
    }
    if (!result?.options.length) return;
    const { lat, lon } = model.graph.stops;
    const pt = i => [lat[i], lon[i]];
    const all = [], selected = [], missingWalks = [];
    // Background itineraries are drawn first; only the selection has stop markers.
    const order = result.options.map((_, i) => i).filter(i => i !== model.selected).concat(model.selected);
    for (const index of order){
      const option = result.options[index], active = index === model.selected;
      const points = [];
      let prev = [ends.from.lat, ends.from.lon];
      option.legs.forEach((leg, k) => {
        if (leg.type === 'walk'){
          const next = k === option.legs.length - 1 ? [ends.to.lat, ends.to.lon] : pt(leg.to);
          const start = leg.from != null ? pt(leg.from) : prev;
          const path = walkCached(start, next);
          if (active && path === undefined) missingWalks.push([start, next]);
          const line = path?.coords || [start, next];
          tripLayer.addLayer(L.polyline(line, { pane: active ? LINE_PANE : ALT_PANE,
            className: active ? 'trip-walk-selected' : 'trip-alternative-walk', color: active ? '#64748b' : '#739bd4',
            weight: active ? 4 : 3, opacity: active ? 1 : .45, dashArray: '2 8', lineCap: 'round', interactive: false }));
          points.push(...line); prev = next; return;
        }
        const route = leg.route, coords = rideCoords(route, leg, pt), color = colorOf(route);
        if (!active){
          const line = L.polyline(coords, { pane: ALT_PANE, className: 'trip-alternative-route',
            color: '#739bd4', weight: 7, opacity: .5, smoothFactor: 0, bubblingMouseEvents: false });
          line.on('click', () => onSelect(index)); tripLayer.addLayer(line);
        } else {
          tripLayer.addLayer(L.polyline(coords, { pane: LINE_PANE, smoothFactor: 0, className: 'trip-route-outline', color: '#334155', weight: 12, opacity: .8, interactive: false }));
          tripLayer.addLayer(L.polyline(coords, { pane: LINE_PANE, smoothFactor: 0, color: '#fff', weight: 10, opacity: .9, interactive: false }));
          tripLayer.addLayer(L.polyline(coords, { pane: LINE_PANE, smoothFactor: 0, color, weight: 6, interactive: false }));
          for (let position = leg.from; position <= leg.to; position++){
            const end = position === leg.from || position === leg.to, stop = route.stops[position];
            tripLayer.addLayer(L.circleMarker(pt(stop), { pane: MARK_PANE, radius: end ? 6.5 : 2.5,
              color: end ? color : '#fff', weight: end ? 3.5 : 1, fillColor: end ? '#fff' : color,
              fillOpacity: 1, bubblingMouseEvents: false
            }).bindTooltip(end ? `${position === leg.from ? 'Sube' : 'Baja'} en ${stopName(stop)}` : stopName(stop),
              { className: 'stop-tip', direction: 'top', offset: [0, -6] }));
          }
        }
        points.push(...coords); prev = coords[coords.length - 1] || prev;
      });
      choiceLines[index] = points; all.push(...points); if (active) selected.push(...points);
    }
    if (fit) fitTo(L.latLngBounds(fitAll ? all : selected));
    choiceLabels();
    void drawWithTracks();
    if (missingWalks.length){
      Promise.all(missingWalks.map(([a, b]) => walkRoute(a, b))).then(paths => {
        if (paths.some(Boolean) && model.result === result) draw({ fit: false });
      });
    }
  }

  function mount(){
    state.map.on('moveend resize', choiceLabels);
    [[ALT_PANE, 475], [LINE_PANE, 480], [MARK_PANE, 640], [LABEL_PANE, 650]].forEach(([name, z]) => {
      if (!state.map.getPane(name)) state.map.createPane(name).style.zIndex = String(z);
    });
  }
  return { mount, draw, addPin, removePin, clear(){ tripLayer?.clearLayers(); choiceLayer?.clearLayers(); choiceLines = []; } };
}
