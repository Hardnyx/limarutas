// Preserve legacy route controls and add a separate planning tab.
import { mountExplorePane } from './explore.js';
import { el } from './utils.js';
export function mountLegacyLayout(){
  const sidebar=document.getElementById('sidebar');
  if(!sidebar) throw new Error('Missing legacy sidebar');
  sidebar.dataset.layoutMounted='legacy';
  const panels=document.getElementById('panels');
  const explore=mountExplorePane();
  const routes=el('button',{id:'tabLegacyRoutes',class:'side-tab',role:'tab','aria-controls':'panels',type:'button'},'Rutas');
  const projects=el('button',{id:'tabExplore',class:'side-tab',role:'tab','aria-controls':'explorePane',type:'button'},'Explorar');
  const tabs=el('div',{class:'side-tabs',role:'tablist','aria-label':'Modo'},routes,projects);
  sidebar.querySelector('.header').after(tabs);
  panels.after(explore);
  const select=active=>{
    routes.setAttribute('aria-selected',String(!active));projects.setAttribute('aria-selected',String(active));
    routes.tabIndex=active?-1:0;projects.tabIndex=active?0:-1;
    panels.hidden=active;explore.hidden=!active;
    document.documentElement.classList.toggle('explore-mode',active);
    if(active) explore.load();
  };
  routes.addEventListener('click',()=>select(false));projects.addEventListener('click',()=>select(true));
  tabs.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const next=e.target===routes?projects:routes;next.click();next.focus();}});
  select(false);
  return {ready(){sidebar.dataset.layoutReady='1';}};
}
