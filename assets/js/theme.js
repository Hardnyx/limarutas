/* Runs before styles so the saved interface theme is applied before paint. */
(() => {
  const key = 'limarutas.theme';
  const listeners = new Set();
  let current = 'light';
  try { if (localStorage.getItem(key) === 'dark') current = 'dark'; } catch {}
  function apply(theme) {
    if (!['light', 'dark'].includes(theme)) return;
    current = theme;
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
    for (const listener of listeners) listener(theme);
  }
  apply(current);
  window.LimaRutasTheme = {
    get: () => current,
    set(theme) {
      if (!['light', 'dark'].includes(theme)) return;
      try { localStorage.setItem(key, theme); } catch {}
      apply(theme);
    },
    bind(light, dark, onChange) {
      const update = theme => {
        for (const [button, value] of [[light, 'light'], [dark, 'dark']]) {
          button.classList.toggle('active', theme === value);
          button.setAttribute('aria-pressed', String(theme === value));
        }
        onChange?.(theme);
      };
      light.addEventListener('click', () => this.set('light'));
      dark.addEventListener('click', () => this.set('dark'));
      listeners.add(update);
      update(current);
    }
  };
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue === 'dark' ? 'dark' : 'light');
  });
})();
