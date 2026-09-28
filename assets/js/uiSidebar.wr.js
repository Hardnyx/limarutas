// uiSidebar.wr.js
// Ítems y listas de Wikiroutes en el sidebar (Transporte público,
// AeroDirecto, Otros, Semiformal).
import { state } from './config.js';
import { isLightColor } from './mapColors.js';
import { el } from './utils.js';
import { syncTriFromLeaf } from './uiSidebar.hierarchy.js';
import { toggleLeaf, refreshLeafDirection } from './leafToggle.js';
import { wrCanonicalCode, loadWrListaMeta, loadWrExtremes, wrFilterRoutesByGroup, loadRoutePhotos } from './wrData.js';
import { wrIsPlaceholder, wrBuildTituloPrincipal, wrParseBaseStops, wrStopsFromExtremesForRoute } from './wrTexts.js';
import { wrIsDefaultColor } from './uiSidebar.wrColorFilter.js';

/* =========================
   Ítem WR: Ida / Vuelta
   ========================= */

// Sin empresa ni alias el título repetía el código ("1507" / "1507"): el
// recorrido pasa a ser el título
function applyWrTextsToWrItem(item, direccion){
  fillWrTexts(item, direccion);
  const titleEl = item.querySelector('.wr-main-title');
  const routeEl = item.querySelector('.wr-subtitle-route');
  const code = item.querySelector('.item-head .tag')?.textContent?.trim().toUpperCase();
  if (titleEl && routeEl && code && titleEl.textContent.trim().toUpperCase() === code && routeEl.textContent){
    titleEl.textContent = routeEl.textContent;
    routeEl.textContent = '';
  }
}

function fillWrTexts(item, direccion){
  const rt   = item.__wrRoute || null;
  const meta = item.__wrMeta  || null;

  const stopsIda     = item.__wrStopsIda || null;
  const stopsVta     = item.__wrStopsVta || null;
  const stopsDefault = item.__wrStops    || null;

  const stops = (direccion === 'vuelta')
    ? (stopsVta || stopsIda || stopsDefault)
    : (stopsIda || stopsDefault);

  const titleEl = item.querySelector('.wr-main-title');
  const distEl  = item.querySelector('.wr-subtitle-dist');
  const routeEl = item.querySelector('.wr-subtitle-route');
  const flagEl  = item.querySelector('.wr-flag');

  if (flagEl){
    flagEl.textContent = meta && meta.estado_wikipedia === 'Inactiva'
      ? 'Según Wikipedia ya no circula' : '';
  }

  if (titleEl){
    titleEl.textContent = wrBuildTituloPrincipal(meta, rt);
  }

if (distEl){
    let ori = meta && meta.distrito_origen ? meta.distrito_origen : '';
    let des = meta && meta.distrito_destino ? meta.distrito_destino : '';
    if (direccion === 'vuelta') [ori, des] = [des, ori];
    distEl.textContent = (ori || des) ? `${ori} \u2192 ${des}` : '';
    if (!distEl.textContent && rt && rt.subtitle) distEl.textContent = rt.subtitle;
    // Si no hay distrito pero sí alias, bajar el alias al subtítulo dist
    if (!distEl.textContent){
      const rawAlias = meta && meta.alias ? String(meta.alias).trim() : '';
      if (rawAlias && !wrIsPlaceholder(rawAlias)) distEl.textContent = rawAlias;
    }
  }

  if (routeEl){
    routeEl.textContent = '';
    let from = stops && stops.from ? stops.from : '';
    let to   = stops && stops.to   ? stops.to   : '';
    if (from || to){
      if (direccion === 'vuelta') [from, to] = [to, from];
      routeEl.textContent = `${from} \u2192 ${to}`;
      return;
    }
    const rawName = (direccion === 'vuelta' && rt && rt.nameVuelta) ? rt.nameVuelta : (rt && rt.name);
    if (rawName){
      let base = String(rawName).trim();
      base = base.replace(/^\s*[^\s·]+\s*·\s*/, '');
      base = base.replace(/\s*\((ida|vuelta)\)\s*$/i, '');
      base = base.replace(/wikiroutes\s*\d*/ig, '').trim();
      const arrow = base.match(/^(.+?)\s*→\s*(.+)$/);
      if (arrow){
        from = arrow[1].trim();
        to   = arrow[2].trim();
        routeEl.textContent = `${from} \u2192 ${to}`;
      } else if (base){
        routeEl.textContent = base;
      }
    }
  }
}

function makeWrDirPairControls(chk){
  const wrap = el('div',{ class:'dir-mini' });

  const mk = (val, label) =>
    el('button',{
      class:`segbtn-mini${(chk.dataset.sel || 'ida') === val ? ' active' : ''}`,
      'data-dir': val
    }, label);

  const bIda = mk('ida','Ida');
  const bVta = mk('vuelta','Vuelta');

  wrap.append(bIda, bVta);

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.segbtn-mini');
    if (!btn) return;

    const sel = btn.dataset.dir;
    if (!sel || sel === chk.dataset.sel) return;

    chk.dataset.sel = sel;
    [bIda, bVta].forEach(b => b.classList.toggle('active', b === btn));

    const item = wrap.closest('.item');
    if (item) applyWrTextsToWrItem(item, sel);

    // Elegir sentido en una ruta sin marcar la muestra (como marcarla);
    // si ya está marcada, cambia de sentido sin mover la vista
    if (!chk.checked) chk.click();
    else refreshLeafDirection(chk);
  });

  return wrap;
}

// Foto referencial con su crédito: "Foto: Autor · CC BY-SA 4.0 · Wikimedia
// Commons" (autor enlaza a la ficha del archivo, licencia a su texto)
function makeWrPhotos(fotos, code){
  const link = (href, text) => /^https:\/\//.test(href || '')
    ? el('a', { href, target: '_blank', rel: 'noopener' }, text) : text;
  return el('div', { class: 'wr-photos', hidden: '' }, ...fotos.map(f => el('figure', { class: 'wr-photo' },
    el('a', { href: f.pagina, target: '_blank', rel: 'noopener' },
      el('img', { src: f.imagen, alt: f.descripcion || `Bus de la ruta ${code}`, loading: 'lazy' })),
    el('figcaption', {}, 'Foto referencial: ', link(f.pagina, f.autor), ' · ',
      link(f.licencia_url, f.licencia), ` · ${f.fuente}`,
      f.codigo_foto ? ` · con su código antiguo ${f.codigo_foto}` : ''))));
}

// Botón "Foto" solo en las rutas con foto; la imagen se pide al abrirla
function attachWrPhotos(body, textBlock, code){
  loadRoutePhotos().then(photos => {
    const fotos = photos[code];
    if (!fotos?.length) return;
    const box = makeWrPhotos(fotos, code);
    const btn = el('button', { type: 'button', class: 'wr-photo-btn', 'aria-expanded': 'false' },
      fotos.length > 1 ? `Fotos (${fotos.length})` : 'Foto');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      box.hidden = !box.hidden;
      btn.setAttribute('aria-expanded', String(!box.hidden));
    });
    textBlock.append(btn);
    body.append(box);
  });
}

function makeWrItem(rt, metaByCodigo, routesById, extremes, systemId='wr'){
  const labelId = (rt.display_id || String(rt.id)).toUpperCase();
  const tagColor = (rt && rt.color) ? rt.color : '#64748b';
  const tag = el('span',{ class: isLightColor(tagColor) ? 'tag on-light' : 'tag', style:`background:${tagColor}` }, labelId);

  const textBlock = el('div',{},
    el('div',{ class:'name wr-main-title' }, ''),
    el('div',{ class:'sub wr-subtitle-dist' }, ''),
    el('div',{ class:'sub wr-subtitle-route' }, ''),
    el('div',{ class:'sub wr-flag' }, '')
  );

  const left = el('div',{ class:'left' }, tag, textBlock);

  let idaRoute = null;
  let vtaRoute = null;
  let idaId = null;
  let vtaId = null;

  function normSide(side){
    let id = null;
    let route = null;

    if (!side) return { id, route };

    if (typeof side === 'string' || typeof side === 'number'){
      id = String(side);
      route = routesById ? (routesById.get(id) || null) : null;
    } else if (typeof side === 'object'){
      if (side.id != null) id = String(side.id);
      if (routesById && id){
        route = routesById.get(id) || side;
      } else {
        route = side;
      }
    }

    return { id, route };
  }

  if (rt && rt.pair){
    const nIda = normSide(rt.pair.ida);
    const nVta = normSide(rt.pair.vuelta);
    idaId = nIda.id;
    idaRoute = nIda.route;
    vtaId = nVta.id;
    vtaRoute = nVta.route;
  }

  const hasBothDirs = !!(idaId && vtaId);

  const dataAttrs = hasBothDirs
    ? {
        'data-id': String(rt.id),
        'data-system': systemId,
        'data-ida': idaId,
        'data-vuelta': vtaId,
        'data-sel': (rt.defaultDir || 'ida')
      }
    : {
        'data-id': String(rt.id),
        'data-system': systemId,
        // Un solo sentido: la capa real (p. ej. "AS10-vuelta")
        'data-layer': String((rt.pair && rt.pair.ida) ? rt.pair.ida : rt.id)
      };

  const chk  = el('input', Object.assign({ type:'checkbox' }, dataAttrs));
  const head = el('div',{ class:'item-head' }, left, chk);

  const body = hasBothDirs
    ? el('div',{ class:'item' }, head, makeWrDirPairControls(chk))
    : el('div',{ class:'item' }, head);
  body.dataset.colorKind = wrIsDefaultColor(rt.color) ? 'default' : 'real';

  const key = wrCanonicalCode(rt.id);
  body.__wrMeta  = metaByCodigo ? (metaByCodigo[key] || null) : null;
  body.__wrRoute = rt;

  const computeStops = (prefId, routeObj, dirKey) => {
    if (prefId != null){
      const byId = wrStopsFromExtremesForRoute(String(prefId), extremes, dirKey);
      if (byId) return byId;
    }
    if (routeObj){
      const byObj = wrStopsFromExtremesForRoute(routeObj, extremes, dirKey);
      if (byObj) return byObj;
    }
    return routeObj ? wrParseBaseStops(routeObj) : { from:'', to:'', label:'' };
  };

  let stopsIda = null;
  let stopsVta = null;

  if (hasBothDirs){
    stopsIda = computeStops(idaId, idaRoute, 'ida');
    stopsVta = computeStops(vtaId, vtaRoute, 'vuelta');
  }

  const stopsDefault = hasBothDirs
    ? (stopsIda || stopsVta || null)
    : (wrStopsFromExtremesForRoute(rt, extremes, 'ida') || wrParseBaseStops(rt));

  body.__wrStopsIda = stopsIda;
  body.__wrStopsVta = stopsVta;
  body.__wrStops    = stopsDefault;

  const initialDir = hasBothDirs ? (chk.dataset.sel || 'ida') : 'ida';
  applyWrTextsToWrItem(body, initialDir);
  attachWrPhotos(body, textBlock, key);

  chk.addEventListener('change', () => {
    toggleLeaf(chk, chk.checked, { fit: true });
    syncTriFromLeaf(systemId);
  });

  return body;
}

/* =========================
   Fillers por grupo
   ========================= */

async function fillWrGroup(list, groupName, systemIdForItems){
  if (!list) return;
  list.innerHTML = '';

  const [metaByCodigo, extremes] = await Promise.all([
    loadWrListaMeta(),
    loadWrExtremes()
  ]);

  const wr = state.systems.wr;
  const allRoutes = Array.isArray(wr.routes) ? wr.routes : [];

  const routesById = new Map();
  allRoutes.forEach(r => {
    if (r && r.id != null) routesById.set(String(r.id), r);
  });

  const srcBase = (Array.isArray(wr.routesUi) && wr.routesUi.length) ? wr.routesUi : allRoutes;
  const src = wrFilterRoutesByGroup(groupName, srcBase);

  (src || []).forEach(rt => {
    if (!rt) return;
    list.appendChild(makeWrItem(rt, metaByCodigo, routesById, extremes, systemIdForItems));
  });
}

export async function fillWrList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.list, 'transporte', 'wr');
}

export async function fillAeroList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.listAero, 'aerodirecto', 'wrAero');
}

export async function fillOtrosList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.listOtros, 'expreso_san_isidro', 'wrOtros');
}

export async function fillSemiformalList(){
  const wr = state.systems.wr;
  await fillWrGroup(wr.ui.listSemi, 'semiformal', 'wrSemi');
}