// routeSteps.js
// Indicaciones de una ruta ("Por Av. Túpac Amaru · 3,2 km", "Gira a la
// derecha en Av. Naranjal", "En el óvalo, toma la 2.ª salida…"): los pasos de
// su recorrido por las calles de OpenStreetMap (build_recorridos.py,
// build_alim_paths.py). Un botón "Recorrido" en la ficha de la ruta; los
// pasos se piden al abrirlo, del sentido elegido.
import { el } from './utils.js';

const km = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });

export function fmtMeters(m){
  if (m >= 1000) return `${km.format(m / 1000)} km`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

const VERB = {
  sigue: 'Sigue por',
  izquierda: 'Gira a la izquierda en',
  derecha: 'Gira a la derecha en',
  vuelta: 'Da la vuelta por'
};

// Texto de un paso, como pipeline/scripts/osm/recorrido.py:texto()
export function stepText(step){
  const via = step.via || 'una calle sin nombre';
  if (step.accion === 'rotonda'){
    return `En el óvalo, toma la ${step.salida}.ª salida${step.via ? ` hacia ${step.via}` : ''}`;
  }
  if (step.accion === 'inicio') return `Por ${via}`;
  return `${VERB[step.accion] || 'Sigue por'} ${via}`;
}

function renderSection({ title, pasos }){
  const list = el('ol', { class: 'route-steps' });
  pasos.forEach(s => {
    list.appendChild(el('li', { class: `route-step route-step-${s.accion}` },
      el('span', { class: 'route-step-text' }, stepText(s)),
      s.accion === 'rotonda' ? '' : el('span', { class: 'route-step-m' }, fmtMeters(s.m))));
  });
  return title ? el('div', { class: 'route-steps-section' }, el('div', { class: 'route-steps-title' }, title), list) : list;
}

// Botón y caja de las indicaciones. getSections() → Promise de
// [{ title?, pasos: [...] }] (un sentido o los dos) o null si no hay.
export function stepsToggle(getSections){
  const box = el('div', { class: 'route-steps-box', hidden: '' });
  const btn = el('button', {
    type: 'button',
    class: 'wr-photo-btn route-steps-btn',
    'aria-expanded': 'false',
    title: 'Por qué calles va, paso a paso'
  }, 'Recorrido');

  let seq = 0;
  async function render(){
    const mine = ++seq;
    box.replaceChildren(el('div', { class: 'route-steps-note' }, 'Cargando…'));
    let sections = null;
    try { sections = await getSections(); } catch { sections = null; }
    if (mine !== seq) return;
    sections = (sections || []).filter(s => s?.pasos?.length);
    box.replaceChildren(...(sections.length
      ? [...sections.map(renderSection),
        el('div', { class: 'route-steps-note' }, 'Calles de OpenStreetMap')]
      : [el('div', { class: 'route-steps-note' }, 'Sin indicaciones para este sentido')]));
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) render();
  });
  // Otro sentido elegido con la caja abierta: sus pasos
  const refresh = () => { if (!box.hidden) render(); };
  return { btn, box, refresh };
}

// Pasos de una ruta de Wikiroutes ("1087-ida"): de su .osm.geojson
const wrCache = new Map();
export function wrSteps(def){
  if (!def?.osm) return Promise.resolve(null);
  const url = `${def.folder}/route_track_trip${def.trip || 1}.osm.geojson`;
  if (!wrCache.has(url)){
    wrCache.set(url, fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(gj => gj?.features?.[0]?.properties?.pasos || null)
      .catch(() => null));
  }
  return wrCache.get(url);
}
