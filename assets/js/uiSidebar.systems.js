import { setControlSelected } from './routeControls.js';
// uiSidebar.systems.js
import { PATHS, COLOR_AN, COLOR_AS, state, getDirFor, setDirFor } from './config.js';
import { isLightColor } from './mapColors.js';
import { $, el } from './utils.js';
import { syncTriFromLeaf } from './uiSidebar.hierarchy.js';
import { toggleLeaf, refreshLeafDirection } from './leafToggle.js';
import { directionsOf, scheduleText } from './metSchedule.js';
import { stepsToggle } from './routeSteps.js';

const labelForSvc = (s) =>
  s.kind === 'regular' ? 'Ruta' : (s.kind === 'expreso' ? 'Expreso' : 'Servicio');

// Direcciones mini (Norte/Sur/Ambas) para Met/Alim
function miniDir(systemId, svc){
  if (systemId === 'corr' || systemId === 'metro') return el('div');
  // Expresos de un solo sentido: no hay nada que elegir
  if (systemId === 'met' && directionsOf(svc).length < 2) return el('div');

  const cur = getDirFor(systemId, svc.id);
  const wrap = el('div',{class:'dir-mini'});

  const mk = (val,label,title) =>
    el('button',{class:`segbtn-mini${cur===val?' active':''}`,'data-dir':val,title},label);

  // Alimentadores: ida (del terminal al barrio) y vuelta, no norte/sur
  const alimP = systemId === 'alim' ? state.systems.alim.paths?.[svc.id] : null;
  if (alimP){
    wrap.append(
      mk('ambas','Amb','Ida y vuelta'),
      mk('sur','Ida',`Hacia ${alimP.ida.to}`),
      mk('norte','Vta',`Hacia ${alimP.vuelta.to}`)
    );
  } else {
    wrap.append(
      mk('ambas','Amb','Ambas'),
      mk('norte','N','Norte'),
      mk('sur','S','Sur')
    );
  }

  wrap.addEventListener('click',(e)=>{
    const b = e.target.closest('.segbtn-mini');
    if (!b) return;

    const dir = b.dataset.dir;
    if (!dir || dir === getDirFor(systemId, svc.id)) return;

    setDirFor(systemId, svc.id, dir);
    wrap.querySelectorAll('.segbtn-mini').forEach(x=>x.classList.toggle('active', x===b));

    const chk = wrap.parentElement.querySelector('.item-head input[type="checkbox"]');
    if (chk){
      // Igual que en Wikiroutes: sin marcar, elegir dirección la muestra
      if (!chk.checked) setControlSelected(chk, true);
      else refreshLeafDirection(chk);
    }
  });

  return wrap;
}

// Recorrido de cada sentido con su horario debajo: "Naranjal → Central" /
// "L–V 6:00–9:00". Si ida y vuelta tienen el mismo horario, una sola: "A ↔ B"
function metTrips(svc){
  const stops = state.systems.met.stops;
  const nameOf = (id) => stops?.get(id)?.name?.replace(/ (Norte|Sur)$/, '') || id;
  const trips = directionsOf(svc).map(dir => {
    const ids = (dir === 'ns' ? svc.north_south : svc.south_north) || svc.stops || [];
    const [a, b] = dir === 'sn' && !svc.south_north ? [ids[ids.length - 1], ids[0]] : [ids[0], ids[ids.length - 1]];
    return { a: nameOf(a), b: nameOf(b), when: scheduleText(svc.schedule?.[dir]) };
  });
  const [x, y] = trips;
  const both = y && x.when === y.when && x.a === y.b && x.b === y.a;
  return (both ? [{ ...x, arrow: '↔' }] : trips.map(t => ({ ...t, arrow: '→' })))
    .map(t => el('div', { class: 'sub met-trip' }, `${t.a} ${t.arrow} ${t.b}`,
      t.when ? el('span', { class: 'met-hours' }, t.when) : ''));
}

function makeServiceItemMet(svc){
  const img = el('img', {
    src:`${PATHS.icons.met}/${String(svc.icon || svc.id).toUpperCase()}.png`,
    class:'badge',
    alt:svc.id
  });

  img.onerror = () =>
    img.replaceWith(
      el('span',{class:'badge', style:`background:${svc.color}`}, String(svc.id))
    );

  const left = el('div',{class:'left'},
    img,
    el('div',{},
      el('div',{class:'name'}, svc.name || `${labelForSvc(svc)} ${svc.id}`),
      ...metTrips(svc)
    )
  );

  const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'met'});
  const head = el('div',{class:'item-head'}, left, chk);
  const body = el('div',{class:'item'}, head, miniDir('met', svc));

  chk.addEventListener('change', () => {
    if (!state.bulk) {
      toggleLeaf(chk, chk.checked, { fit: true });
      syncTriFromLeaf('met');
    }
  });

  return body;
}

// "Naranjal → Tahuantinsuyo → Naranjal" (circuito) o "Zona Norte"
function alimTripText(svc){
  const p = state.systems.alim.paths?.[svc.id];
  if (!p) return `Zona ${svc.zone === 'NORTE' ? 'Norte' : 'Sur'}`;
  const from = p.vuelta?.to || '';
  return p.loop ? `Circuito: ${from} → ${p.ida.to} → ${from}` : `${from} ↔ ${p.ida.to}`;
}

// Horario oficial de salida del terminal (portal de la ATU), si lo hay
function alimHours(svc){
  const p = state.systems.alim.paths?.[svc.id];
  return p?.ida?.horario ? el('span', { class: 'met-hours' }, `Sale ${p.ida.horario}`) : '';
}

// Trazado desde un mapa QR que no alcanza para seguirlo calle por calle
function alimAprox(svc){
  const p = state.systems.alim.paths?.[svc.id];
  return p?.aprox ? el('span', { class: 'met-hours', title: 'Trazado a partir del mapa QR de la ATU: puede no seguir todas sus calles' }, 'Trazado aproximado') : '';
}

function makeServiceItemAlim(svc){
  const code = String(svc.id).toUpperCase();
  const bg = svc.color || (code.startsWith('AN') ? COLOR_AN : COLOR_AS);
  const tag = el('span',{
    class: isLightColor(bg) ? 'tag on-light' : 'tag',
    style:`background:${bg}`
  }, code);

  const textBlock = el('div',{},
    el('div',{class:'name'}, svc.name || `Alimentador ${code}`),
    el('div',{class:'sub met-trip'}, alimTripText(svc), alimHours(svc), alimAprox(svc))
  );
  const left = el('div',{class:'left'}, tag, textBlock);

  const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'alim'});
  const head = el('div',{class:'item-head'}, left, chk);
  const dirs = miniDir('alim', svc);
  const body = el('div',{class:'item'}, head, dirs);

  // Indicaciones del sentido elegido (o de los dos)
  const p = state.systems.alim.paths?.[svc.id];
  if (p?.ida?.pasos || p?.vuelta?.pasos){
    const { btn, box, refresh } = stepsToggle(async () => {
      const dir = getDirFor('alim', svc.id);
      const ida = { pasos: p.ida?.pasos, sinCalle: p.ida?.sin_calle || 0 };
      const vta = { pasos: p.vuelta?.pasos, sinCalle: p.vuelta?.sin_calle || 0 };
      if (dir === 'sur') return [ida];
      if (dir === 'norte') return [vta];
      return [{ ...ida, title: `Ida · hacia ${p.ida?.to || ''}` }, { ...vta, title: `Vuelta · hacia ${p.vuelta?.to || ''}` }];
    });
    textBlock.append(btn);
    body.append(box);
    dirs.addEventListener('click', () => setTimeout(refresh));
  }

  chk.addEventListener('change', () => {
    if (!state.bulk) {
      toggleLeaf(chk, chk.checked, { fit: true });
      syncTriFromLeaf('alim');
    }
  });

  return body;
}

function makeServiceItemMetro(svc){
  const code = String(svc.id).toUpperCase();
  const fileBaseNow = code.replace(/^L/i, '');
  const primary = `${PATHS.icons.metro}/${fileBaseNow}.png`;
  const alt     = `${PATHS.icons.metro}/${code}.png`;

  const ico = new Image();
  ico.alt = code;
  ico.className = 'badge';
  ico.src = primary;
  ico.onerror = () => {
    if (!ico.dataset.altTried) {
      ico.dataset.altTried = '1';
      ico.src = alt;
    } else {
      ico.replaceWith(
        el('span',{class: isLightColor(svc.color) ? 'tag on-light' : 'tag', style:`background:${svc.color}`}, code)
      );
    }
  };

  const left = el('div',{class:'left'},
    ico,
    el('div',{},
      el('div',{class:'name'}, `Línea ${code}`),
      el('div',{class:'sub'}, svc.name || '')
    )
  );

  const chk  = el('input',{type:'checkbox','data-id':svc.id,'data-system':'metro'});
  const head = el('div',{class:'item-head'}, left, chk);
  const body = el('div',{class:'item'}, head);

  chk.addEventListener('change', () => {
    if (!state.bulk) {
      toggleLeaf(chk, chk.checked, { fit: true });
      syncTriFromLeaf('metro');
    }
  });

  return body;
}

export function fillMetList(){
  const sys = state.systems.met;
  sys.ui.listReg.innerHTML = '';
  sys.ui.listExp.innerHTML = '';

  const reg = sys.services.filter(s => s.kind === 'regular');
  const exp = sys.services.filter(s => s.kind === 'expreso');

  reg.forEach(s => sys.ui.listReg.appendChild(makeServiceItemMet(s)));
  exp.forEach(s => sys.ui.listExp.appendChild(makeServiceItemMet(s)));
}

export function fillAlimList(){
  const sys = state.systems.alim;
  sys.ui.listN.innerHTML = '';
  sys.ui.listS.innerHTML = '';

  sys.services.filter(s => s.zone === 'NORTE')
    .forEach(s => sys.ui.listN.appendChild(makeServiceItemAlim(s)));

  sys.services.filter(s => s.zone === 'SUR')
    .forEach(s => sys.ui.listS.appendChild(makeServiceItemAlim(s)));
}

export function fillMetroList(){
  const sys = state.systems.metro;
  const list = sys.ui.list;
  if (!list) return;

  list.innerHTML = '';
  sys.services.forEach(s => list.appendChild(makeServiceItemMetro(s)));
}
