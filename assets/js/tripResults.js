import { $, el } from './utils.js';
import { distM } from './geo.js';
import { oldWouldHelp, offHoursHelp } from './tripPlanner.js';
import { scheduleText, nextStart } from './metSchedule.js';
import { paintTag } from './routeInspector.js';
import { leafForService, setControlSelected } from './routeControls.js';
import { icon } from './icons.js';
import { colorOf, routeName, cardName, fmtM, walkMinOf } from './tripPresentation.js';

export function createTripResults(model, { setCompact, departure, setDeparture, replan, shareTrip, onSelect }){
  const { ends } = model;
  // Chip de la ruta: su alias ("La 36") si tiene; si no, el código
  function chip(route){
    const c = el('span', { class: 'tag trip-chip' }, route.alias || route.code);
    paintTag(c, colorOf(route));
    const name = routeName(route);
    c.title = [name, route.alias ? `ruta ${route.code}` : ''].filter(Boolean).join(' · ');
    return c;
  }

  // Nombre para la tarjeta: sin repetir el alias del chip y con el código
  // de la ruta, que es el que figura en el bus y en la ATU
  const stopName = i => model.graph.stops.name[i] || 'paradero';
  // Hacia dónde va: el último paradero; en un alimentador, el barrio o la estación
  const headsign = r => r.headsign || stopName(r.stops[r.stops.length - 1]);

  // Estaciones del Metropolitano (nodos del grafo), para explicar por qué se
  // camina a una más lejana
  let metNodes = null;
  function metStations(){
    if (!metNodes){
      metNodes = new Set();
      for (const r of model.graph.routes) if (r.group === 'metropolitano') r.stops.forEach(i => metNodes.add(i));
    }
    return metNodes;
  }

  // "El Expreso 2 no para en Canaval y Moreyra, que está más cerca": cuando la
  // estación de subida no es la más cercana al punto de partida del tramo a pie
  function skippedNearer(from, ride){
    if (ride?.type !== 'ride' || ride.route.group !== 'metropolitano') return null;
    const r = ride.route;
    const board = r.stops[ride.from];
    const { lat, lon } = model.graph.stops;
    const d = i => distM(from[0], from[1], lat[i], lon[i]);
    const own = new Set(r.stops);
    let best = null;
    for (const i of metStations()){
      if (own.has(i) || stopName(i) === stopName(board)) continue;
      if (d(i) + 150 < d(board) && (!best || d(i) < d(best))) best = i;
    }
    if (best == null) return null;
    const name = routeName(r).replace(/^Metropolitano · /, '');
    return `${/^Ruta\b/.test(name) ? 'La' : 'El'} ${name} no para en ${stopName(best)}, que está más cerca`;
  }

  function stepsOf(opt){
    const steps = [];
    opt.legs.forEach((leg, k) => {
      if (leg.type === 'walk'){
        if (leg.m < 15) return;
        const where = k === 0 ? `hasta ${stopName(leg.to)}`
          : k === opt.legs.length - 1 ? 'hasta tu destino'
            : `hasta ${stopName(leg.to)} para el transbordo`;
        const start = leg.from != null ? [model.graph.stops.lat[leg.from], model.graph.stops.lon[leg.from]] : [ends.from.lat, ends.from.lon];
        const why = k < opt.legs.length - 1 && skippedNearer(start, opt.legs[k + 1]);
        // Tras el Metropolitano, primero se sale de la estación
        const exit = opt.legs[k + 1]?.exitMin || 0;
        steps.push(el('li', { class: 'trip-step trip-step-walk' },
          el('span', { class: 'trip-step-ico' }, icon('walk')),
          el('span', {}, `${exit ? 'Sal de la estación y camina' : 'Camina'} ${fmtM(leg.m)} ${where}`,
            el('span', { class: 'trip-sub' }, ` · ${walkMinOf(leg.m) + exit} min`),
            why ? el('div', { class: 'trip-sub trip-why' }, why) : '')));
      } else {
        // Sin caminata entre medio (el bus para en la puerta de la estación)
        const prevLeg = opt.legs[k - 1];
        if (leg.exitMin && !(prevLeg?.type === 'walk' && prevLeg.m >= 15)){
          steps.push(el('li', { class: 'trip-step trip-step-walk' },
            el('span', { class: 'trip-step-ico' }, icon('walk')),
            el('span', {}, 'Sal de la estación', el('span', { class: 'trip-sub' }, ` · ${leg.exitMin} min`))));
        }
        const r = leg.route;
        const n = leg.to - leg.from;
        const alts = leg.alts || [];
        // "Sube a la La 36" no: con alias, "Sube a [La 36]" y el código aparte
        const text = el('span', {},
          r.alias ? 'Sube a ' : 'Sube a la ', chip(r), ' en ', el('b', {}, stopName(r.stops[leg.from])),
          ' y baja en ', el('b', {}, stopName(r.stops[leg.to])),
          el('span', { class: 'trip-sub' }, `${r.alias ? ` · ruta ${r.code}` : ''} · ${n} paradero${n === 1 ? '' : 's'} · dirección ${headsign(r)}`));
        if (r.schedule){
          text.append(el('div', { class: 'trip-hours' }, `Horario: ${scheduleText(r.schedule)}`));
        }
        // Intervalo de la ficha técnica del PRR (sin horario: todo el día)
        if (r.headway){
          const wait = Math.max(1, Math.round(leg.wait || r.headway / 2));
          text.append(el('div', { class: 'trip-hours' },
            `Pasa cada ~${r.headway} min según la ATU · espera ~${wait} min${alts.length ? ' con cualquiera' : ''}`));
        }
        if (alts.length){
          const also = el('div', { class: 'trip-also' }, 'O la que pase primero: ');
          alts.forEach((a, i) => { if (i) also.append(' '); also.append(chip(a.route)); });
          text.append(also);
        }
        if (r.group === 'antigua'){
          text.append(' ', el('span', { class: 'trip-warn' }, r.verified ? 'Sin autorización ATU' : 'Ruta antigua · podría no circular'));
        }
        steps.push(el('li', { class: 'trip-step trip-step-ride', style: `--c:${colorOf(r)}` },
          el('span', { class: 'trip-step-ico' }, icon(r.group === 'metro' ? 'subway' : 'bus')), text));
      }
    });
    return steps;
  }

  // Por qué va cada opción donde va: la primera es la recomendada; se marcan
  // la más rápida y la de menos caminata si son otras
  function badgesOf(options){
    const out = new Map();
    if (!options.length) return out;
    out.set(options[0], 'Recomendada');
    const fastest = options.reduce((a, b) => (b.minutes < a.minutes ? b : a));
    if (!out.has(fastest)) out.set(fastest, 'Más rápida');
    const leastWalk = options.reduce((a, b) => (b.walkM < a.walkM ? b : a));
    if (!out.has(leastWalk) && leastWalk.walkM + 150 < options[0].walkM) out.set(leastWalk, 'Menos caminata');
    return out;
  }

  let badges = null;
  // "45 min", "2 h 16 min"
  function fmtDur(min){
    const m = Math.round(min);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  }

  // Hora de llegada estimada ("12:46") según la Salida
  function arrivalText(min){
    const at = departure();
    const t = (at.min + Math.round(min)) % (24 * 60);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // Tira del viaje, como en las apps de transporte: (a pie) 7 › [1115] o [1116] › (a pie) 3
  function stripOf(opt){
    const strip = el('div', { class: 'trip-strip' });
    const parts = [];
    const multi = opt.legs.filter(l => l.type === 'ride').length > 1;
    opt.legs.forEach(leg => {
      if (leg.type === 'walk'){
        if (leg.m < 15) return;
        parts.push(el('span', { class: 'trip-seg-walk', title: `Caminar ${fmtM(leg.m)}` },
          el('span', { class: 'trip-walk-ico', 'aria-hidden': 'true' }, icon('walk')), String(walkMinOf(leg.m))));
      } else {
        const seg = el('span', { class: 'trip-seg-ride' }, chip(leg.route));
        const alts = (leg.alts || []).map(a => a.route);
        // Con transbordo, las equivalentes solo como "+N" (la tira no entraría en una línea)
        if (alts.length && multi){
          seg.append(el('span', { class: 'trip-plus', title: 'También te sirven:\n' + alts.map(r => `${r.alias || r.code} · ${cardName(r)}`).join('\n') }, `+${alts.length}`));
        } else if (alts.length){
          const c = chip(alts[0]); c.classList.add('trip-chip-sm');
          const or = el('span', { class: 'trip-or-alts', title: 'También te sirven:\n' + alts.map(r => `${r.alias || r.code} · ${cardName(r)}`).join('\n') }, 'o', c);
          if (alts.length > 1) or.append(el('span', { class: 'trip-plus' }, `+${alts.length - 1}`));
          seg.append(or);
        }
        parts.push(seg);
      }
    });
    parts.forEach((p, i) => { if (i) strip.append(el('span', { class: 'trip-sep', 'aria-hidden': 'true' }, '›')); strip.append(p); });
    return strip;
  }

  function card(opt, k){
    const rides = opt.legs.filter(l => l.type === 'ride');
    const isOpen = k === model.selected;
    const where = !opt.transfers ? 'Sin transbordo'
      : `${opt.transfers} transbordo${opt.transfers > 1 ? 's' : ''} en ${rides.slice(1).map(l => stopName(l.route.stops[l.from])).join(' y ')}`;
    const names = rides.map(l => cardName(l.route)).filter(Boolean).join(', luego ');
    const head = el('div', { class: 'trip-card-head' },
      el('div', { class: 'trip-legs' }, stripOf(opt), el('div', { class: 'trip-name' }, names)),
      el('div', { class: 'trip-time' }, fmtDur(opt.minutes),
        el('small', { class: 'trip-arrive' }, `llegas ~${arrivalText(opt.minutes)}`)));
    const badge = badges?.get(opt);
    const body = el('div', { class: 'trip-card', role: 'button', tabindex: '0', 'aria-expanded': String(isOpen) },
      badge ? el('div', { class: 'trip-card-label' }, el('span', { class: 'trip-badge' }, badge)) : '',
      head, el('div', { class: 'trip-meta' }, `${where} · `,
        el('span', { class: opt.walkM > 1000 ? 'trip-walk-long' : '' }, opt.walkM < 15 ? 'sin caminar' : `${fmtM(opt.walkM)} a pie`)));
    if (opt.recommendationReason) body.append(el('div', { class: 'trip-reason' }, opt.recommendationReason));
    if (opt.old) body.append(el('div', { class: 'trip-warn' }, 'Usa una ruta antigua: podría no circular'));
    if (isOpen){
      body.classList.add('selected');
      const ol = el('ol', { class: 'trip-steps' }, ...stepsOf(opt));
      const show = el('button', { type: 'button', class: 'btn small btn-ghost trip-show' }, 'Ver rutas completas');
      show.title = 'Marca estas rutas y abre la pestaña Rutas';
      show.addEventListener('click', (e) => {
        e.stopPropagation();
        rides.forEach(l => { const leaf = leafForService(l.route.system, l.route.id); if (leaf && !leaf.checked) setControlSelected(leaf, true); });
        $('#tabRoutes')?.click();
      });
      const share = el('button', { type: 'button', class: 'btn small btn-ghost trip-share' }, 'Compartir');
      share.title = 'Copiar el enlace de este viaje';
      share.addEventListener('click', (e) => { e.stopPropagation(); void shareTrip(share); });
      body.append(ol, el('div', { class: 'trip-actions' }, show, share));
    }
    const pickCard = () => onSelect(k);
    body.addEventListener('click', pickCard);
    body.addEventListener('keydown', (e) => { if (e.target === body && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); pickCard(); } });
    return body;
  }

  async function renderResults(){
    const box = $('#tripResults');
    if (!box || !model.result) return;
    box.innerHTML = '';
    if (model.result.walkOnly){
      box.append(el('div', { class: 'trip-empty' },
        `Está a ${fmtM(model.result.meters)}: te conviene caminar (unos ${walkMinOf(model.result.meters)} min).`));
      return;
    }
    if (!model.result.options.length){
      const msg = el('div', { class: 'trip-empty' }, 'No encontramos un viaje directo ni con un transbordo entre estos puntos.');
      box.append(msg);
      if (!$('#tripOld').checked && oldWouldHelp(model.graph, ends.from, ends.to, { at: departure() })){
        const b = el('button', { type: 'button', class: 'btn small' }, 'Buscar también con rutas antiguas');
        b.addEventListener('click', () => { $('#tripOld').checked = true; void replan(); });
        msg.append(el('div', { class: 'trip-empty-hint' }, 'Hay opciones con rutas antiguas, que podrían ya no circular. ', b));
      }
      offHoursNote(box);
      return;
    }
    badges = badgesOf(model.result.options);
    setCompact(true);
    model.result.options.forEach((opt, k) => box.append(card(opt, k)));
    offHoursNote(box);
    box.append(el('div', { class: 'muted trip-note' }, 'Tiempos estimados por distancia; incluyen una espera según cada cuánto pasa el bus.'));
  }

  // Servicios que servirían pero no circulan a la hora de salida: tocarlos
  // cambia la Salida a su próximo horario y recalcula
  function offHoursNote(box){
    const at = departure();
    const off = offHoursHelp(model.graph, ends.from, ends.to, { includeOld: $('#tripOld').checked, at });
    if (!off.length) return;
    const note = el('div', { class: 'trip-offhours' }, 'En otro horario también te sirve:');
    off.forEach(r => {
      const next = nextStart(r.schedule, at);
      const b = el('button', { type: 'button', class: 'trip-offhours-item', title: 'Buscar con esa hora de salida' },
        chip(r), ' ', el('span', { class: 'trip-name' }, cardName(r)),
        el('span', { class: 'trip-sub' }, scheduleText(r.schedule)));
      if (next) b.addEventListener('click', () => setDeparture(next));
      note.append(b);
    });
    box.append(note);
  }

  return { render: renderResults };
}
