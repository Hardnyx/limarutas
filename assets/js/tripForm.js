import { $, el } from './utils.js';
import { limaTime, DAY_NAMES } from './metSchedule.js';
import { icon } from './icons.js';
const MAX_SUGGEST = 8;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createTripForm(model, { ensureGraph, setEnd, removePin, addPin, clearResults, syncUrl, startPicking, replan }){
  const { ends } = model;
  const stopChoices = new Map();   // includeOld → lista
  function choices(){
    const includeOld = !!$('#tripOld')?.checked;
    if (stopChoices.has(includeOld)) return stopChoices.get(includeOld);
    const usable = r => r.group !== 'antigua' || r.verified || includeOld;
    const byKey = new Map();
    const { name, district, cross, swap, alias, lat, lon } = model.graph.stops;
    for (let i = 0; i < model.graph.stops.count; i++){
      if (!name[i]) continue;
      const n = new Set(model.graph.atStop[i].filter(([ri]) => usable(model.graph.routes[ri])).map(([ri]) => model.graph.routes[ri].serviceId)).size;
      if (!n) continue;
      // Un lugar por cruce ("Universitaria con Colonial", "… con Izaguirre"):
      // buscar "universitaria" los trae a todos; "universitaria colonial", ese.
      // Los dos paraderos de un cruce (Brasil y Javier Prado), uno solo
      const label = cross[i] || name[i];
      const crossKey = norm(label).split(/\s+/).filter(w => w !== 'con').sort().join(' ');
      const key = `${crossKey}|${district[i]}`;
      const cur = byKey.get(key);
      if (!cur || n > cur.n){
        byKey.set(key, { i, n, name: label, swap: swap[i], district: district[i], lat: lat[i], lon: lon[i],
          q: norm(label), qs: norm(swap[i]), qa: norm(alias[i]), alias: alias[i] });
      }
    }
    const list = Array.from(byKey.values()).sort((a, b) => b.n - a.n);
    stopChoices.set(includeOld, list);
    return list;
  }

  // Primero los que tienen todas las palabras; si no hay, los que coinciden en
  // más texto ("ovalo higuereta" → "Higuereta"). Las palabras cortas ("de") no bastan solas.
  function suggestStops(text){
    const words = norm(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const all = [];
    const some = [];
    for (const c of choices()){
      const hay = `${c.q} | ${c.qs} | ${c.qa}`;
      const hit = words.filter(w => hay.includes(w));
      if (hit.length === words.length){
        all.push(shown(c, words));
        if (all.length >= MAX_SUGGEST) return all;
      } else if (hit.some(w => w.length >= 4)){
        // Cuánto del texto coincide: "higuereta" pesa más que "ovalo"
        some.push([hit.reduce((n, w) => n + w.length, 0), c]);
      }
    }
    if (all.length) return all;
    return some.sort((x, y) => y[0] - x[0] || y[1].n - x[1].n).slice(0, MAX_SUGGEST).map(x => shown(x[1], words));
  }

  // Cómo se muestra: empezando por la calle que se buscó ("javier prado" →
  // "Javier Prado con Brasil"); si se encontró por otro nombre, cuál
  function shown(c, words){
    const first = words[0];
    const swapIt = c.swap && !c.q.startsWith(first) && c.qs.startsWith(first);
    const via = !c.q.includes(first) && !c.qs.includes(first)
      ? (c.alias.split(' · ').find(a => norm(a).includes(first)) || '') : '';
    return { ...c, name: swapIt ? c.swap : c.name, via };
  }

  /* =========================
     Formulario
     ========================= */

  function setStatus(text){
    const s = $('#tripStatus');
    if (s) s.textContent = text;
  }

  function field(end, letter, placeholder){
    const input = el('input', {
      type: 'text', id: end === 'from' ? 'tripFrom' : 'tripTo', class: 'trip-input',
      placeholder, autocomplete: 'off', 'aria-label': placeholder
    });
    const pick = el('button', { type: 'button', class: 'trip-pick', 'data-end': end,
      title: 'Elegir en el mapa', 'aria-label': `Elegir ${end === 'from' ? 'origen' : 'destino'} en el mapa` }, icon('pin'));
    const clear = el('button', { type: 'button', class: 'trip-clear', 'data-end': end, 'aria-label': 'Borrar' }, icon('close'));
    const list = el('div', { class: 'suggest trip-suggest', role: 'listbox' });
    const wrap = el('div', { class: 'trip-field', 'data-end': end },
      el('span', { class: `trip-dot trip-dot-${end}` }, letter), input, clear, pick, list);

    let items = [];
    let active = -1;
    const close = () => { list.classList.remove('open'); list.innerHTML = ''; items = []; active = -1; };
    const choose = (c) => {
      close();
      setEnd(end, { lat: c.lat, lon: c.lon, label: `${c.name} · ${c.district}` });
    };
    const render = () => {
      list.innerHTML = '';
      if (!items.length && input.value.trim()){
        list.appendChild(el('div', { class: 'suggest-empty' },
          'Ningún paradero con ese nombre. Prueba con otra palabra o elige el punto en el mapa con el botón del pin.'));
        list.classList.add('open');
        return;
      }
      items.forEach((c, k) => {
        const row = el('div', { class: `suggest-item${k === active ? ' selected' : ''}`, role: 'option' },
          el('span', { class: 's-ico s-ico-stop' }, '●'),
          el('div', {}, el('div', { class: 's-label' }, c.name), el('div', { class: 's-sub' }, [c.via, c.district, `${c.n} rutas`].filter(Boolean).join(' · '))));
        row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(c); });
        list.appendChild(row);
      });
      list.classList.toggle('open', items.length > 0);
      // El elegido con las flechas, a la vista
      list.querySelector('.suggest-item.selected')?.scrollIntoView({ block: 'nearest' });
    };

    input.addEventListener('focus', () => { void ensureGraph(); });
    input.addEventListener('input', async () => {
      ends[end] = null;
      removePin(end);
      clearResults();
      syncUrl();
      if (!input.value.trim()){ close(); return; }
      await ensureGraph();
      items = suggestStops(input.value);
      active = items.length ? 0 : -1;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length){ e.preventDefault(); active = (active + 1) % items.length; render(); }
      else if (e.key === 'ArrowUp' && items.length){ e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
      else if (e.key === 'Enter' && active >= 0){ e.preventDefault(); choose(items[active]); }
      else if (e.key === 'Escape' && list.classList.contains('open')){ e.stopPropagation(); close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    clear.addEventListener('click', () => { input.value = ''; ends[end] = null; removePin(end); clearResults(); syncUrl(); close(); input.focus(); });
    pick.addEventListener('click', () => startPicking(end));
    return wrap;
  }

  // Hora de salida (Lima): "Ahora" o un día y hora. El Metropolitano tiene
  // horarios; el resto se asume en servicio a cualquier hora.
  function departure(){
    const day = $('#tripDay')?.value;
    if (!day || day === 'now') return limaTime();
    const [h, m] = ($('#tripTime').value || '08:00').split(':').map(Number);
    return { day: Number(day), min: h * 60 + m };
  }

  function whenRow(){
    const now = limaTime();
    // De lunes a domingo
    const days = [1, 2, 3, 4, 5, 6, 0].map(d => el('option', { value: String(d) }, DAY_NAMES[d]));
    const nowOpt = el('option', { value: 'now' }, 'Ahora');
    const daySel = el('select', { id: 'tripDay', 'aria-label': 'Día de salida' }, nowOpt, ...days);
    // "Ahora (8:05)": la hora que se usa, al día cuando se abre la lista
    const refreshNow = () => {
      const n = limaTime();
      nowOpt.textContent = `Ahora (${Math.floor(n.min / 60)}:${String(n.min % 60).padStart(2, '0')})`;
    };
    refreshNow();
    daySel.addEventListener('focus', refreshNow);
    daySel.addEventListener('pointerdown', refreshNow);
    const hh = String(Math.floor(now.min / 60)).padStart(2, '0');
    const mm = String(now.min % 60).padStart(2, '0');
    const time = el('input', { type: 'time', id: 'tripTime', value: `${hh}:${mm}`, 'aria-label': 'Hora de salida', hidden: '' });
    daySel.addEventListener('change', () => { time.hidden = daySel.value === 'now'; void replan(); });
    time.addEventListener('change', () => { void replan(); });
    return el('label', { class: 'trip-opt trip-when', title: 'Día y hora de salida' },
      el('span', { class: 'trip-opt-ico', 'aria-hidden': 'true' }, icon('clock')), daySel, time);
  }

  function buildForm(pane){
    pane.innerHTML = '';
    const oldChk = el('input', { type: 'checkbox', id: 'tripOld' });
    // En el celular, con resultados, el formulario se resume en una línea que
    // se toca para editar (así se ven más opciones)
    const summary = el('button', { type: 'button', class: 'trip-summary', 'aria-label': 'Editar origen, destino y salida' },
      el('span', { class: 'trip-summary-text' }), el('span', { class: 'trip-summary-edit' }, 'Editar'));
    summary.addEventListener('click', () => setCompact(false));
    pane.append(summary,
      el('div', { class: 'trip-form' },
        field('from', 'A', 'Paradero o cruce de origen'),
        field('to', 'B', 'Paradero o cruce de destino'),
        // Opciones en una fila de chips: salida, invertir, rutas antiguas
        el('div', { class: 'trip-opts' },
          whenRow(),
          el('button', { type: 'button', id: 'tripSwap', class: 'trip-opt trip-opt-icon', title: 'Invertir origen y destino', 'aria-label': 'Invertir origen y destino' }, icon('swap')),
          el('label', { class: 'trip-opt trip-old', title: 'Incluir rutas sin autorización de la ATU; podrían ya no circular' }, oldChk, 'Rutas antiguas'))),
      el('div', { id: 'tripStatus', class: 'muted trip-status', role: 'status' }),
      el('div', { id: 'tripResults', class: 'trip-results' }),
      // Se ve mientras no hay resultados (CSS: #tripResults:empty + .trip-help)
      el('div', { class: 'trip-help' },
        el('p', {}, 'Escribe el nombre de un paradero en A y B, o toca ', icon('pin', 'ico-inline'), ' y elige el punto en el mapa.'),
        el('p', {}, 'También puedes abrir un paradero en el mapa y usar "Salir de aquí" o "Llegar aquí".'),
        el('p', {}, 'Con "Salida" eliges el día y la hora: los expresos del Metropolitano solo circulan en ciertos horarios.')));

    oldChk.addEventListener('change', () => { void replan(); });
    $('#tripSwap').addEventListener('click', () => {
      [ends.from, ends.to] = [ends.to, ends.from];
      ['from', 'to'].forEach(k => { removePin(k); if (ends[k]) addPin(k); });
      syncInputs();
      void replan();
    });
  }

  function setCompact(on){
    const pane = $('#tripPane');
    if (!pane) return;
    const compact = on && document.documentElement.classList.contains('sheet') && !!(ends.from && ends.to);
    pane.classList.toggle('trip-compact', compact);
    if (compact){
      const day = $('#tripDay');
      const when = day?.value === 'now' ? 'Ahora' : `${day?.selectedOptions[0]?.textContent} ${$('#tripTime').value}`;
      $('.trip-summary-text').textContent = `${ends.from.label} → ${ends.to.label} · ${when}`;
    }
  }

  function syncInputs(){
    $('#tripFrom').value = ends.from?.label || '';
    $('#tripTo').value = ends.to?.label || '';
  }

  function setDeparture({ day, min }){
    $('#tripDay').value = String(day);
    const time = $('#tripTime');
    time.value = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    time.hidden = false;
    void replan();
  }

  return { buildForm, setCompact, syncInputs, departure, setDeparture, setStatus };
}
