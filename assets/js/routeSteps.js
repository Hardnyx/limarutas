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

// Lo que el recorrido no cubre: los km fuera de Lima (una interprovincial,
// las playas del sur) y los pedazos sin calle en OSM, donde la línea sigue
// el dibujo
const outNote = (text) => el('div', { class: 'route-steps-out' }, text);

function renderSection({ title, pasos, fuera = [], sinCalle = 0 }){
  const list = el('ol', { class: 'route-steps' });
  pasos.forEach(s => {
    list.appendChild(el('li', { class: `route-step route-step-${s.accion}` },
      el('span', { class: 'route-step-text' }, stepText(s)),
      s.accion === 'rotonda' ? '' : el('span', { class: 'route-step-m' }, fmtMeters(s.m))));
  });
  const [before = 0, after = 0] = fuera || [];
  const parts = [
    title ? el('div', { class: 'route-steps-title' }, title) : '',
    before >= 500 ? outNote(`Viene de fuera de Lima: ${fmtMeters(before)} sin indicaciones`) : '',
    list,
    after >= 500 ? outNote(`Sigue fuera de Lima: ${fmtMeters(after)} sin indicaciones`) : '',
    sinCalle ? outNote(sinCalle === 1
      ? 'Un pedazo no tiene calle en OpenStreetMap: ahí la línea sigue el dibujo'
      : `${sinCalle} pedazos no tienen calle en OpenStreetMap: ahí la línea sigue el dibujo`) : ''
  ].filter(Boolean);
  return el('div', { class: 'route-steps-section' }, ...parts);
}

// Atribución de los datos (ODbL)
function osmCredit(){
  return el('div', { class: 'route-steps-note' }, 'Calles: © ',
    el('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' },
      'colaboradores de OpenStreetMap'));
}

// Botón y caja de las indicaciones. getSections() → Promise de
// [{ title?, pasos: [...], fuera?: [m antes, m después], sinCalle? }] (un
// sentido o los dos) o null si no hay.
export function stepsToggle(getSections){
  const box = el('div', { class: 'route-steps-box', hidden: '' });
  const btn = el('button', {
    type: 'button',
    class: 'route-steps-btn',
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
        osmCredit()]
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

// Indicaciones de una ruta de Wikiroutes ("1087-ida"): de su .osm.geojson,
// { pasos, fuera, sinCalle } o null
const wrCache = new Map();
export function wrSteps(def){
  if (!def?.osm) return Promise.resolve(null);
  const url = `${def.folder}/route_track_trip${def.trip || 1}.osm.geojson`;
  if (!wrCache.has(url)){
    wrCache.set(url, fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(gj => {
        const pr = gj?.features?.[0]?.properties;
        return pr?.pasos ? { pasos: pr.pasos, fuera: pr.fuera || [], sinCalle: pr.sin_calle || 0 } : null;
      })
      .catch(() => null));
  }
  return wrCache.get(url);
}
