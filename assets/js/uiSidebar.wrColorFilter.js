// uiSidebar.wrColorFilter.js
// Depuración (Transporte público): separar rutas con color definido de las
// que usan el color metálico por defecto.
import { $, $$ } from './utils.js';
import { bulk, setLeafChecked, syncAllTri } from './uiSidebar.hierarchy.js';

/* =========================
   Depuración: rutas con color por defecto
   ========================= */

// COLORES_PLACEHOLDER de build_lista_rutas_atu.py (azul metálico),
// el gris de wr_sync_indexes.py y el fallback de app.js
const WR_DEFAULT_COLORS = new Set([
  '#3D6B7A', '#4A7A8A', '#527585', '#5C8FA0', '#4F7F90',
  '#6595A5', '#3A6878', '#608090', '#456878', '#5A8595',
  '#888888', '#00008C'
]);

export function wrIsDefaultColor(color){
  const c = String(color || '').trim().toUpperCase();
  return !c || WR_DEFAULT_COLORS.has(c);
}

// mode: 'all' | 'real' | 'default'. Solo Transporte público; las rutas
// ocultas se desmarcan y las casillas de grupo ignoran las ocultas.
export function applyWrColorFilter(mode){
  const counts = { all: 0, real: 0, default: 0 };
  bulk(() => {
    $$('#p-wr .item').forEach(item => {
      const kind = item.dataset.colorKind;
      counts.all++;
      if (kind in counts) counts[kind]++;

      const hide = mode !== 'all' && kind !== mode;
      item.classList.toggle('is-color-filtered', hide);
      if (hide){
        const chk = item.querySelector('.item-head input[type=checkbox]');
        if (chk && chk.checked) setLeafChecked('wr', chk, false);
      }
    });
  });
  syncAllTri();

  $$('#wrColorFilter [data-count]').forEach(span => {
    span.textContent = `(${counts[span.dataset.count]})`;
  });
  $$('#wrColorFilter .segbtn-mini').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

export function wireWrColorFilter(){
  const box = $('#wrColorFilter');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('.segbtn-mini[data-mode]');
    if (btn) applyWrColorFilter(btn.dataset.mode);
  });
  applyWrColorFilter('all');
}
