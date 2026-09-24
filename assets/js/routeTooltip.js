// routeTooltip.js
// Contenido del tooltip al pasar el mouse sobre una ruta de Wikiroutes.
// Reutiliza lo que ya muestra el ítem del sidebar (código, color, título,
// extremos) para que mapa y lista digan lo mismo.
import { el } from './utils.js';

function findRouteItem(subId){
  const base = String(subId).replace(/-(ida|vuelta)$/i, '');
  const q = (attr, v) => `#panels .item .item-head input[type="checkbox"][${attr}="${CSS.escape(v)}"]`;
  const chk =
    document.querySelector(q('data-ida', subId)) ||
    document.querySelector(q('data-vuelta', subId)) ||
    document.querySelector(q('data-id', base));
  return chk ? chk.closest('.item') : null;
}

export function wrRouteTooltip(subId){
  const item = findRouteItem(subId);

  const tagSrc = item?.querySelector('.item-head .left .tag');
  const tag = el('span', { class: 'tag route-tip-tag' },
    tagSrc ? tagSrc.textContent : String(subId).replace(/-(ida|vuelta)$/i, '').toUpperCase());
  if (tagSrc?.style.background) tag.style.background = tagSrc.style.background;

  const title = item?.querySelector('.item-head .name')?.textContent?.trim() || '';

  // Una sola línea: distritos (dicen más que el nombre de un paradero);
  // si no hay, los paraderos extremos del sentido que está en el mapa
  const subs = item ? item.querySelectorAll('.item-head .sub') : [];
  const dist = item?.querySelector('.wr-subtitle-dist')?.textContent?.trim();
  const route = (item?.querySelector('.wr-subtitle-route')?.textContent
    || subs[subs.length - 1]?.textContent || '').trim();
  const sub = (dist && dist !== title) ? dist : route;

  const text = el('div', { class: 'route-tip-text' });
  if (title) text.appendChild(el('div', { class: 'route-tip-title' }, title));
  if (sub) text.appendChild(el('div', { class: 'route-tip-sub' }, sub));

  return el('div', { class: 'route-tip-body' }, tag, text);
}
