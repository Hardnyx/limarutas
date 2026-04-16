// uiSidebar.hierarchy.js
import { state } from './config.js';
import { $, $$ } from './utils.js';
import { onToggleService, setWikiroutesVisible } from './mapLayers.js';

/* =========================
   Utilidad de "operaciones en lote"
   ========================= */
export function bulk(fn){
  state.bulk = true;
  try { fn(); } finally { state.bulk = false; }
}

/* =========================
   Helpers: encontrar checkboxes hoja
   ========================= */
export function routeCheckboxesOf(systemId, groupChk=null){
  if (systemId==='met'){
    if (groupChk === state.systems.met.ui.chkReg) return $$('#p-met-reg .item input[type=checkbox]');
    if (groupChk === state.systems.met.ui.chkExp) return $$('#p-met-exp .item input[type=checkbox]');
    return $$('#p-met-reg .item input[type=checkbox], #p-met-exp .item input[type=checkbox]');
  }

  if (systemId==='alim'){
    if (groupChk === state.systems.alim.ui.chkN) return $$('#p-met-alim-n .item input[type=checkbox]');
    if (groupChk === state.systems.alim.ui.chkS) return $$('#p-met-alim-s .item input[type=checkbox]');
    return $$('#p-met-alim .item input[type=checkbox]');
  }

  if (systemId==='corr'){
    if (groupChk && groupChk.dataset.group){
      const g = groupChk.dataset.group;
      const sub = groupChk.dataset.sub;
      const panel = sub ? $(`#p-corr-${g}-${sub}`) : $(`#p-corr-${g}`);
      return panel
        ? Array.from(panel.querySelectorAll('.item input[type=checkbox]'))
        : [];
    }
    return $$('#p-corr-list .item input[type=checkbox]');
  }

  if (systemId==='metro'){
    return $$('#p-metro .item input[type=checkbox]');
  }

  if (systemId==='wr'){
    return $$('#p-wr .item input[type=checkbox]');
  }

  if (systemId==='wrAero'){
    return $$('#p-wr-aero .item input[type=checkbox]');
  }

  if (systemId==='wrOtros'){
    return $$('#p-wr-esi .item input[type=checkbox]');
  }

  if (systemId==='wrSemi'){
    return $$('#p-wr-semi .item input[type=checkbox]');
  }

  return [];
}

/* =========================
   Set leaf checked
   ========================= */
export function setLeafChecked(systemId, leafChk, checked, {silentFit=false}={}){ // eslint-disable-line no-unused-vars
  if (!leafChk) return;
  if (leafChk.checked === checked) return;

  leafChk.checked = checked;

  const id = leafChk.dataset.id;
  if (!id) return;

  // Corredores: si viene como par ida/vuelta (corrWr), togglear como WR
  if (systemId === 'corr'){
    const ida = leafChk.dataset.ida;
    const vta = leafChk.dataset.vuelta;
    if (ida && vta){
      const sel = leafChk.dataset.sel || 'ida';
      if (checked){
        if (sel === 'ida'){
          setWikiroutesVisible(ida, true, {fit:!silentFit});
          setWikiroutesVisible(vta, false);
        } else {
          setWikiroutesVisible(vta, true, {fit:!silentFit});
          setWikiroutesVisible(ida, false);
        }
      } else {
        setWikiroutesVisible(ida, false);
        setWikiroutesVisible(vta, false);
      }
      return;
    }
  }

  // Wikiroutes: soporta ítems con ida/vuelta o simples
  if (systemId === 'wr' || systemId === 'wrAero' || systemId === 'wrOtros' || systemId === 'wrSemi') {
    const ida = leafChk.dataset.ida;
    const vta = leafChk.dataset.vuelta;

    if (ida && vta){
      const sel = leafChk.dataset.sel || 'ida';
      if (checked){
        if (sel === 'ida'){
          setWikiroutesVisible(ida, true, {fit:!silentFit});
          setWikiroutesVisible(vta, false);
        } else {
          setWikiroutesVisible(vta, true, {fit:!silentFit});
          setWikiroutesVisible(ida, false);
        }
      } else {
        setWikiroutesVisible(ida, false);
        setWikiroutesVisible(vta, false);
      }
      return;
    }

    if (checked) setWikiroutesVisible(id, true, {fit:!silentFit});
    else setWikiroutesVisible(id, false);
    return;
  }

  // Resto de sistemas
  onToggleService(systemId, id, checked, {silentFit});
}

/* =========================
   Set group checked (nivel 2 y 3)
   ========================= */
export function setLevel2Checked(systemId, groupChk, checked, {silentFit=false}={}){
  if (!groupChk) return;

  groupChk.checked = checked;
  groupChk.indeterminate = false;

  const leaves = routeCheckboxesOf(systemId, groupChk);
  leaves.forEach(ch => setLeafChecked(systemId, ch, checked, {silentFit}));
}

/* =========================
   Handlers nivel 1 y 2
   ========================= */
function onLevel1ChangeMet(){
  const v = state.systems.met.ui.chkAll.checked;
  bulk(()=>{
    setLevel2Checked('met', state.systems.met.ui.chkReg, v, {silentFit:true});
    setLevel2Checked('met', state.systems.met.ui.chkExp, v, {silentFit:true});
  });
  syncAllTri();
}
function onLevel2ChangeMet(groupChk){
  const v = groupChk.checked;
  bulk(()=> setLevel2Checked('met', groupChk, v, {silentFit:true}));
  syncAllTri();
}

function onLevel1ChangeAlim(){
  const v = state.systems.alim.ui.chkAll.checked;
  bulk(()=>{
    setLevel2Checked('alim', state.systems.alim.ui.chkN, v, {silentFit:true});
    setLevel2Checked('alim', state.systems.alim.ui.chkS, v, {silentFit:true});
  });
  syncAllTri();
}
function onLevel2ChangeAlim(groupChk){
  const v = groupChk.checked;
  bulk(()=> setLevel2Checked('alim', groupChk, v, {silentFit:true}));
  syncAllTri();
}

export function onLevel1ChangeCorr(){
  const v = state.systems.corr.ui.chkAll.checked;
  bulk(()=>{
    for (const {chk} of state.systems.corr.ui.groups.values()){
      setLevel2Checked('corr', chk, v, {silentFit:true});
    }
  });
  syncAllTri();
}

export function onLevel2ChangeCorr(groupChk){
  const v = groupChk.checked;
  bulk(()=> setLevel2Checked('corr', groupChk, v, {silentFit:true}));
  syncAllTri();
}

export function onLevel3ChangeCorr(subChk){
  const v = subChk.checked;
  bulk(()=> setLevel2Checked('corr', subChk, v, {silentFit:true}));
  syncAllTri();
}

export function onLevel1ChangeMetro(){
  const v = state.systems.metro.ui.chkAll.checked;
  bulk(()=> setLevel2Checked('metro', state.systems.metro.ui.chkAll, v, {silentFit:true}));
  syncAllTri();
}

export function onLevel1ChangeWr(){
  const v = state.systems.wr.ui.chkAll.checked;
  bulk(()=> setLevel2Checked('wr', state.systems.wr.ui.chkAll, v, {silentFit:true}));
  syncAllTri();
}

export function onLevel1ChangeWrAero(){
  const ui = state.systems.wr.ui;
  if (!ui.chkAero) return;
  const v = ui.chkAero.checked;
  bulk(()=> setLevel2Checked('wrAero', ui.chkAero, v, {silentFit:true}));
  syncAllTri();
}

export function onLevel1ChangeWrOtros(){
  const ui = state.systems.wr.ui;
  if (!ui.chkOtros) return;
  const v = ui.chkOtros.checked;
  bulk(()=>{
    if (ui.chkEsi){ ui.chkEsi.checked = v; ui.chkEsi.indeterminate = false; }
    setLevel2Checked('wrOtros', ui.chkOtros, v, {silentFit:true});
  });
  syncAllTri();
}

export function onLevel1ChangeWrSemi(){
  const ui = state.systems.wr.ui;
  if (!ui.chkSemi) return;
  const v = ui.chkSemi.checked;
  bulk(()=> setLevel2Checked('wrSemi', ui.chkSemi, v, {silentFit:true}));
  syncAllTri();
}

/* =========================
   Sync tri-state
   ========================= */
function syncTriOfGroup(systemId, groupChk){
  if (!groupChk) return;

  const leaves = routeCheckboxesOf(systemId, groupChk);
  const total = leaves.length;
  const checked = leaves.filter(c => c.checked).length;

  groupChk.indeterminate = checked > 0 && checked < total;
  groupChk.checked = total > 0 && checked === total;
}

export function syncTriFromLeaf(systemId){
  if (systemId === 'met'){
    syncTriOfGroup('met', state.systems.met.ui.chkReg);
    syncTriOfGroup('met', state.systems.met.ui.chkExp);

    const b = [state.systems.met.ui.chkReg, state.systems.met.ui.chkExp];
    const allChecked = b.every(x => x && x.checked);
    const anyChecked = b.some(x => x && (x.checked || x.indeterminate));

    const top = state.systems.met.ui.chkAll;
    top.indeterminate = anyChecked && !allChecked;
    top.checked = allChecked;
    return;
  }

  if (systemId === 'alim'){
    syncTriOfGroup('alim', state.systems.alim.ui.chkN);
    syncTriOfGroup('alim', state.systems.alim.ui.chkS);

    const b = [state.systems.alim.ui.chkN, state.systems.alim.ui.chkS];
    const allChecked = b.every(x => x && x.checked);
    const anyChecked = b.some(x => x && (x.checked || x.indeterminate));

    const top = state.systems.alim.ui.chkAll;
    top.indeterminate = anyChecked && !allChecked;
    top.checked = allChecked;
    return;
  }

  if (systemId === 'corr'){
    // Primero pestañas (nivel 3), luego grupos (nivel 2)
    for (const g of state.systems.corr.ui.groups.values()){
      if (g && g.tabs){
        for (const t of g.tabs.values()){
          if (t && t.chk) syncTriOfGroup('corr', t.chk);
        }
      }
      if (g && g.chk) syncTriOfGroup('corr', g.chk);
    }

    const leaves = routeCheckboxesOf('corr');
    const total = leaves.length;
    const checked = leaves.filter(c => c.checked).length;

    const top = state.systems.corr.ui.chkAll;
    top.indeterminate = checked > 0 && checked < total;
    top.checked = total > 0 && checked === total;
    return;
  }

  if (systemId === 'metro'){
    const top = state.systems.metro.ui.chkAll;
    const leaves = routeCheckboxesOf('metro');
    const total = leaves.length;
    const checked = leaves.filter(c => c.checked).length;

    top.indeterminate = checked > 0 && checked < total;
    top.checked = total > 0 && checked === total;
    return;
  }

  if (systemId === 'wr'){
    const top = state.systems.wr.ui.chkAll;
    const leaves = routeCheckboxesOf('wr');
    const total = leaves.length;
    const checked = leaves.filter(c => c.checked).length;

    if (top){
      top.indeterminate = checked > 0 && checked < total;
      top.checked = total > 0 && checked === total;
    }
    return;
  }

  if (systemId === 'wrAero'){
    const top = state.systems.wr.ui.chkAero;
    if (!top) return;

    const leaves = routeCheckboxesOf('wrAero');
    const total = leaves.length;
    const checked = leaves.filter(c => c.checked).length;

    top.indeterminate = checked > 0 && checked < total;
    top.checked = total > 0 && checked === total;
    return;
  }

  if (systemId === 'wrOtros'){
    const top = state.systems.wr.ui.chkOtros;
    const mid = state.systems.wr.ui.chkEsi;

    const leaves = routeCheckboxesOf('wrOtros');
    const total = leaves.length;
    const checked = leaves.filter(c => c.checked).length;

    if (mid){
      mid.indeterminate = checked > 0 && checked < total;
      mid.checked = total > 0 && checked === total;
    }
    if (top){
      top.indeterminate = checked > 0 && checked < total;
      top.checked = total > 0 && checked === total;
    }
    return;
  }

  if (systemId === 'wrSemi'){
    const top = state.systems.wr.ui.chkSemi;
    if (!top) return;
    const leaves = routeCheckboxesOf('wrSemi');
    const total = leaves.length;
    const checked = leaves.filter(c => c.checked).length;
    top.indeterminate = checked > 0 && checked < total;
    top.checked = total > 0 && checked === total;
    return;
  }

}

export function syncAllTri(){
  ['met','alim','corr','metro','wr','wrAero','wrOtros','wrSemi'].forEach(syncTriFromLeaf);
}

/* =========================
   Wire handlers
   ========================= */
export function wireHierarchy(){
  state.systems.met.ui.chkAll.addEventListener('change', onLevel1ChangeMet);
  state.systems.met.ui.chkReg.addEventListener('change', () => onLevel2ChangeMet(state.systems.met.ui.chkReg));
  state.systems.met.ui.chkExp.addEventListener('change', () => onLevel2ChangeMet(state.systems.met.ui.chkExp));

  state.systems.alim.ui.chkAll.addEventListener('change', onLevel1ChangeAlim);
  state.systems.alim.ui.chkN.addEventListener('change', () => onLevel2ChangeAlim(state.systems.alim.ui.chkN));
  state.systems.alim.ui.chkS.addEventListener('change', () => onLevel2ChangeAlim(state.systems.alim.ui.chkS));

  state.systems.corr.ui.chkAll.addEventListener('change', onLevel1ChangeCorr);

  state.systems.metro.ui.chkAll.addEventListener('change', onLevel1ChangeMetro);

  state.systems.wr.ui.chkAll.addEventListener('change', onLevel1ChangeWr);

  if (state.systems.wr.ui.chkAero){
    state.systems.wr.ui.chkAero.addEventListener('change', onLevel1ChangeWrAero);
  }
  if (state.systems.wr.ui.chkOtros){
    state.systems.wr.ui.chkOtros.addEventListener('change', onLevel1ChangeWrOtros);
  }

  if (state.systems.wr.ui.chkSemi){
    state.systems.wr.ui.chkSemi.addEventListener('change', onLevel1ChangeWrSemi);
  }

  if (state.systems.wr.ui.chkEsi){
    state.systems.wr.ui.chkEsi.addEventListener('change', () => {
      const ui = state.systems.wr.ui;
      const v = ui.chkEsi.checked;
      bulk(()=> setLevel2Checked('wrOtros', ui.chkEsi, v, {silentFit:true}));
      syncAllTri();
    });
  }

  syncAllTri();
}
