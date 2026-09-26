// uiDialog.js
// Diálogo propio de la página (en vez de window.confirm): botones que dicen
// exactamente qué hacen. Devuelve una promesa con el valor del botón elegido.
//
//   const v = await askChoice({
//     title: 'Muchas rutas',
//     message: 'Vas a mostrar 440 rutas…',
//     choices: [
//       { label: 'Mostrar sin paraderos', value: 'nostops', primary: true },
//       { label: 'Mostrar con paraderos', value: 'stops' },
//       { label: 'Cancelar', value: 'cancel' }
//     ],
//     cancelValue: 'cancel'      // Esc o clic fuera
//   });
import { el } from './utils.js';

let current = null;   // diálogo abierto (uno a la vez)

export function askChoice({ title, message, choices, cancelValue = null }){
  if (current) current.close(cancelValue);

  return new Promise(resolve => {
    const previousFocus = document.activeElement;

    const buttons = choices.map(c => {
      const b = el('button', {
        type: 'button',
        class: `btn ui-dialog-btn${c.primary ? ' primary' : ''}`,
        'data-value': String(c.value)
      }, c.label);
      b.addEventListener('click', () => close(c.value));
      return b;
    });

    const titleId = 'ui-dialog-title';
    const box = el('div', { class: 'ui-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      el('div', { class: 'ui-dialog-title', id: titleId }, title || ''),
      el('div', { class: 'ui-dialog-msg' }, message || ''),
      el('div', { class: 'ui-dialog-actions' }, ...buttons)
    );
    const backdrop = el('div', { class: 'ui-dialog-backdrop' }, box);

    const onKey = (e) => {
      if (e.key === 'Escape'){ e.preventDefault(); close(cancelValue); }
    };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(cancelValue); });
    document.addEventListener('keydown', onKey, true);

    function close(value){
      if (!backdrop.isConnected) return;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      current = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(value);
    }

    document.body.appendChild(backdrop);
    current = { close };
    (buttons.find(b => b.classList.contains('primary')) || buttons[0])?.focus();
  });
}
