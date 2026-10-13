/* Apply the saved interface theme before paint; map preference is independent. */
(() => {
  function channel(key, applyTheme){
    const listeners=new Set();let current='light';
    try { if(localStorage.getItem(key)==='dark') current='dark'; } catch {}
    const apply=theme=>{
      if(!['light','dark'].includes(theme)) return;
      current=theme;applyTheme?.(theme);
      for(const listener of listeners) listener(theme);
    };
    apply(current);
    const api={
      get:()=>current,
      set(theme){
        if(!['light','dark'].includes(theme)) return;
        try { localStorage.setItem(key,theme); } catch {}
        apply(theme);
      },
      bind(light,dark,onChange){
        const update=theme=>{
          for(const [button,value] of [[light,'light'],[dark,'dark']]){
            if(!button) continue;
            button.classList.toggle('active',theme===value);
            button.setAttribute('aria-pressed',String(theme===value));
          }
          onChange?.(theme);
        };
        light?.addEventListener('click',()=>api.set('light'));
        dark?.addEventListener('click',()=>api.set('dark'));
        listeners.add(update);update(current);
      }
    };
    window.addEventListener('storage',event=>{
      if(event.key===key || event.key===null) apply(event.newValue==='dark'?'dark':'light');
    });
    return api;
  }
  window.LimaRutasTheme=channel('limarutas.theme',theme=>{
    document.documentElement.classList.toggle('theme-dark',theme==='dark');
    document.documentElement.dataset.theme=theme;
  });
  window.LimaRutasMapTheme=channel('limarutas.mapTheme',theme=>{
    document.documentElement.dataset.mapTheme=theme;
  });
})();
