// mobileSheet.js
// Nueva interfaz en celular (?beta=1, pantallas angostas): el sidebar es una
// hoja que sube desde abajo, con tres alturas:
//   peek  solo pestañas y buscador (se ve casi todo el mapa)
//   half  la mitad de la pantalla (al abrir la página)
//   full  casi toda la pantalla (al escribir en el buscador)
// Se arrastra desde la manija o se toca para alternar peek ↔ half. Lo que
// tapa la hoja se guarda en state.mapInsets para que el encuadre lo evite.
import { state } from './config.js';
import { $, el } from './utils.js';

// Evento en document cuando el usuario elige algo que quiere ver en el mapa
export const MAP_PICK = 'limarutas:map-pick';

const MQ = window.matchMedia('(max-width: 700px)');
const TOP_GAP = 64;   // en "full" queda a la vista el botón ⚙

let sheet = null;
let current = 'half';

function heights(){
  const vh = window.innerHeight;
  const panels = $('#routesPane:not([hidden]) #panels') || $('#tripPane:not([hidden])');
  // peek: hasta el final del buscador / "En el mapa"
  const peek = panels ? Math.min(panels.offsetTop + 8, vh * 0.4) : 170;
  return { peek, half: Math.round(vh * 0.5), full: vh - TOP_GAP };
}

function apply(h, animate = true){
  sheet.classList.toggle('sheet-dragging', !animate);
  sheet.style.height = `${Math.round(h)}px`;
  document.documentElement.style.setProperty('--sheet-h', `${Math.round(h)}px`);
  state.mapInsets = { bottom: Math.round(h) };
}

export function setSheet(name){
  if (!sheet || !document.documentElement.classList.contains('sheet')) return;
  current = name;
  sheet.dataset.sheet = name;
  document.documentElement.dataset.sheet = name;
  apply(heights()[name]);
  const handle = $('#sheetHandle');
  if (handle) handle.setAttribute('aria-expanded', String(name !== 'peek'));
}

function enable(on){
  document.documentElement.classList.toggle('sheet', on);
  if (on){
    setSheet(current);
  } else {
    sheet.style.height = '';
    document.documentElement.style.removeProperty('--sheet-h');
    delete sheet.dataset.sheet;
    delete document.documentElement.dataset.sheet;
    state.mapInsets = null;
  }
}

function wireDrag(handle){
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    start = { y: e.clientY, h: sheet.offsetHeight, t: e.timeStamp, moved: false };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dy = start.y - e.clientY;
    if (Math.abs(dy) > 6) start.moved = true;
    if (!start.moved) return;
    const { peek, full } = heights();
    apply(Math.max(peek * 0.8, Math.min(full, start.h + dy)), false);
  });
  const end = (e) => {
    if (!start) return;
    const s = start;
    start = null;
    if (!s.moved){
      // Tocar: alterna entre asomada y media
      setSheet(current === 'peek' ? 'half' : 'peek');
      return;
    }
    // Soltar: la altura más cercana, con algo de impulso
    const h = sheet.offsetHeight;
    const v = (s.y - e.clientY) / Math.max(1, e.timeStamp - s.t);   // px/ms, + hacia arriba
    const target = h + v * 250;
    const hs = heights();
    const name = Object.keys(hs).reduce((a, b) => Math.abs(hs[a] - target) <= Math.abs(hs[b] - target) ? a : b);
    setSheet(name);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    const order = ['peek', 'half', 'full'];
    const i = order.indexOf(current);
    if (e.key === 'ArrowUp' && i < 2){ e.preventDefault(); setSheet(order[i + 1]); }
    if (e.key === 'ArrowDown' && i > 0){ e.preventDefault(); setSheet(order[i - 1]); }
  });
}

export function wireMobileSheet(){
  sheet = $('#sidebar');
  if (!sheet || sheet.dataset.sheetWired) return;
  sheet.dataset.sheetWired = '1';

  const handle = el('button', {
    type: 'button', id: 'sheetHandle', class: 'sheet-handle',
    'aria-label': 'Mostrar u ocultar el menú', 'aria-controls': 'sidebar', 'aria-expanded': 'true'
  }, el('span', { class: 'sheet-grip' }));
  sheet.prepend(handle);
  wireDrag(handle);

  // Escribir necesita espacio (y el teclado tapa la mitad de abajo)
  $('#searchInput')?.addEventListener('focus', () => setSheet('full'));
  // Lo elegido se ve en el mapa
  document.addEventListener(MAP_PICK, () => {
    if (document.activeElement === $('#searchInput')) document.activeElement.blur();
    setSheet('peek');
  });
  state.map?.on('click', () => { if (current !== 'peek') setSheet('peek'); });
  // Cambiar de pestaña con la hoja asomada: mostrar el contenido
  $('.side-tabs')?.addEventListener('click', () => { if (current === 'peek') setSheet('half'); });

  // "En el mapa" aparece o desaparece: la hoja asomada debe seguir mostrándolo
  const onMap = $('#onMap');
  if (onMap && window.ResizeObserver){
    new ResizeObserver(() => { if (current === 'peek') setSheet('peek'); }).observe(onMap);
  }

  MQ.addEventListener('change', () => enable(MQ.matches));
  window.addEventListener('resize', () => { if (MQ.matches) setSheet(current); });
  enable(MQ.matches);
}
